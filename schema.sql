BEGIN;

CREATE TABLE IF NOT EXISTS ingredients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50)
);

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

CREATE TABLE IF NOT EXISTS recipe_sync_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    last_attempt_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cocktail_ingredients (
    cocktail_id INT NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    ingredient_id INT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    amount VARCHAR(50),
    PRIMARY KEY (cocktail_id, ingredient_id)
);

INSERT INTO ingredients (name, category) VALUES
    ('Vodka', 'Spirit'),
    ('White Rum', 'Spirit'),
    ('Tequila', 'Spirit'),
    ('Lime Juice', 'Mixer'),
    ('Triple Sec', 'Liqueur'),
    ('Simple Syrup', 'Mixer'),
    ('Mint Leaves', 'Garnish'),
    ('Club Soda', 'Mixer'),
    ('Cola', 'Mixer'),
    ('Salt', 'Garnish')
ON CONFLICT (name) DO NOTHING;

INSERT INTO cocktails (name, instructions, glassware, image_url) VALUES
    ('Mojito', 'Muddle mint leaves with simple syrup and lime juice. Add rum and top with club soda over ice.', 'Highball', 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a'),
    ('Margarita', 'Shake tequila, triple sec, and lime juice with ice. Strain into a salt-rimmed glass.', 'Margarita Glass', 'https://images.unsplash.com/photo-1556881286-fc6915169721')
ON CONFLICT (name) DO NOTHING;

INSERT INTO cocktail_ingredients (cocktail_id, ingredient_id, amount)
SELECT c.id, i.id, recipe.amount
FROM (VALUES
    ('Mojito', 'White Rum', '2 oz'),
    ('Mojito', 'Lime Juice', '1 oz'),
    ('Mojito', 'Simple Syrup', '0.5 oz'),
    ('Mojito', 'Mint Leaves', '10 leaves'),
    ('Mojito', 'Club Soda', 'Top up'),
    ('Margarita', 'Tequila', '2 oz'),
    ('Margarita', 'Triple Sec', '1 oz'),
    ('Margarita', 'Lime Juice', '1 oz'),
    ('Margarita', 'Salt', 'For the rim')
) AS recipe(cocktail_name, ingredient_name, amount)
JOIN cocktails c ON c.name = recipe.cocktail_name
JOIN ingredients i ON i.name = recipe.ingredient_name
ON CONFLICT (cocktail_id, ingredient_id) DO NOTHING;

COMMIT;