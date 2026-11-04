BEGIN;

CREATE TABLE IF NOT EXISTS ingredients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50)
);

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS abv NUMERIC(5, 4);
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS is_alcoholic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS allergens TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS cocktails (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    instructions TEXT NOT NULL,
    glassware VARCHAR(50),
    image_url TEXT,
    source_id VARCHAR(32),
    source_url TEXT
);

ALTER TABLE cocktails ADD COLUMN IF NOT EXISTS source_id VARCHAR(32);
ALTER TABLE cocktails ADD COLUMN IF NOT EXISTS source_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS cocktails_source_id_unique_idx
    ON cocktails (source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cocktail_ingredients (
    cocktail_id INT NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    ingredient_id INT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    amount VARCHAR(50),
    PRIMARY KEY (cocktail_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS recipe_sync_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    last_attempt_at TIMESTAMPTZ
);

-- Only explicitly approved sources may be queried or published from.
CREATE TABLE IF NOT EXISTS source_registry (
    source_key VARCHAR(80) PRIMARY KEY,
    domain TEXT NOT NULL,
    license TEXT,
    trust_tier VARCHAR(30) NOT NULL DEFAULT 'unverified',
    allowed_use BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source_registry (source_key, domain, trust_tier, allowed_use)
VALUES ('thecocktaildb', 'thecocktaildb.com', 'structured_source', FALSE)
ON CONFLICT (source_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS recipe_candidates (
    id BIGSERIAL PRIMARY KEY,
    source_key VARCHAR(80) NOT NULL REFERENCES source_registry(source_key),
    source_id VARCHAR(100) NOT NULL,
    source_url TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'duplicate', 'needs_review', 'blocked_license', 'rejected', 'normalized', 'validated', 'approved', 'published')),
    duplicate_of BIGINT REFERENCES recipe_candidates(id),
    source_payload JSONB NOT NULL,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_key, source_id)
);
CREATE INDEX IF NOT EXISTS recipe_candidates_status_idx ON recipe_candidates(status, discovered_at DESC);
CREATE INDEX IF NOT EXISTS recipe_candidates_normalized_name_idx ON recipe_candidates(normalized_name);

CREATE TABLE IF NOT EXISTS ingredient_aliases (
    id BIGSERIAL PRIMARY KEY,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL UNIQUE,
    ingredient_id INT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipes (
    id BIGSERIAL PRIMARY KEY,
    cocktail_id INT UNIQUE REFERENCES cocktails(id) ON DELETE SET NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    family TEXT,
    base_spirit TEXT,
    glass TEXT,
    method TEXT,
    serving TEXT,
    instructions TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'review', 'approved', 'published', 'rejected')),
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('curated', 'imported', 'ai_generated')),
    confidence NUMERIC(4, 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id INT NOT NULL REFERENCES ingredients(id),
    quantity NUMERIC(10, 3),
    unit VARCHAR(30) NOT NULL,
    original_text TEXT,
    optional BOOLEAN NOT NULL DEFAULT FALSE,
    garnish BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL,
    PRIMARY KEY (recipe_id, ingredient_id, sort_order)
);

CREATE TABLE IF NOT EXISTS recipe_sources (
    id BIGSERIAL PRIMARY KEY,
    recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    publisher TEXT NOT NULL,
    license TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (recipe_id, url)
);

CREATE TABLE IF NOT EXISTS recipe_versions (
    id BIGSERIAL PRIMARY KEY,
    recipe_id BIGINT REFERENCES recipes(id) ON DELETE CASCADE,
    candidate_id BIGINT NOT NULL REFERENCES recipe_candidates(id) ON DELETE CASCADE,
    version INT NOT NULL,
    payload_json JSONB NOT NULL,
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('draft', 'normalized', 'validated', 'approved', 'published', 'rejected', 'needs_review')),
    reviewer TEXT,
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, version)
);

INSERT INTO ingredients (name, category, is_alcoholic) VALUES
    ('Vodka', 'Spirit', TRUE),
    ('White Rum', 'Spirit', TRUE),
    ('Tequila', 'Spirit', TRUE),
    ('Lime Juice', 'Mixer', FALSE),
    ('Triple Sec', 'Liqueur', TRUE),
    ('Simple Syrup', 'Mixer', FALSE),
    ('Mint Leaves', 'Garnish', FALSE),
    ('Club Soda', 'Mixer', FALSE),
    ('Cola', 'Mixer', FALSE),
    ('Salt', 'Garnish', FALSE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO ingredient_aliases (alias, normalized_alias, ingredient_id)
SELECT aliases.alias, aliases.normalized_alias, ingredients.id
FROM (VALUES
    ('vodka', 'vodka'), ('white rum', 'white rum'), ('rum', 'white rum'),
    ('tequila', 'tequila'), ('lime juice', 'lime juice'), ('fresh lime juice', 'lime juice'),
    ('triple sec', 'triple sec'), ('simple syrup', 'simple syrup'),
    ('mint', 'mint leaves'), ('mint leaves', 'mint leaves'),
    ('club soda', 'club soda'), ('soda water', 'club soda'), ('cola', 'cola'), ('salt', 'salt')
) AS aliases(alias, canonical_name)
JOIN ingredients ON LOWER(ingredients.name) = aliases.canonical_name
ON CONFLICT (normalized_alias) DO NOTHING;

INSERT INTO cocktails (name, instructions, glassware, image_url) VALUES
    ('Mojito', 'Muddle mint leaves with simple syrup and lime juice. Add rum and top with club soda over ice.', 'Highball', 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a'),
    ('Margarita', 'Shake tequila, triple sec, and lime juice with ice. Strain into a salt-rimmed glass.', 'Margarita Glass', 'https://images.unsplash.com/photo-1556881286-fc6915169721')
ON CONFLICT (name) DO NOTHING;

INSERT INTO cocktail_ingredients (cocktail_id, ingredient_id, amount)
SELECT c.id, i.id, recipe.amount
FROM (VALUES
    ('Mojito', 'White Rum', '2 oz'), ('Mojito', 'Lime Juice', '1 oz'),
    ('Mojito', 'Simple Syrup', '0.5 oz'), ('Mojito', 'Mint Leaves', '10 leaves'),
    ('Mojito', 'Club Soda', 'Top up'), ('Margarita', 'Tequila', '2 oz'),
    ('Margarita', 'Triple Sec', '1 oz'), ('Margarita', 'Lime Juice', '1 oz'),
    ('Margarita', 'Salt', 'For the rim')
) AS recipe(cocktail_name, ingredient_name, amount)
JOIN cocktails c ON c.name = recipe.cocktail_name
JOIN ingredients i ON i.name = recipe.ingredient_name
ON CONFLICT (cocktail_id, ingredient_id) DO NOTHING;

COMMIT;
