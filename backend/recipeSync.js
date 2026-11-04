const API_KEY = process.env.COCKTAILDB_API_KEY || '1';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_RECIPES_PER_RUN = 2;
const MAX_ATTEMPTS = 4;

async function fetchRandomDrink() {
  const url = `https://www.thecocktaildb.com/api/json/v1/${encodeURIComponent(API_KEY)}/random.php`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`CocktailDB request failed with status ${response.status}`);
  const payload = await response.json();
  return payload.drinks?.[0] || null;
}

function normalizeDrink(drink) {
  if (!drink || !drink.idDrink || !drink.strDrink || !drink.strInstructions) return null;

  const ingredients = [];
  for (let index = 1; index <= 15; index += 1) {
    const name = drink[`strIngredient${index}`]?.trim();
    if (!name) continue;
    ingredients.push({
      name,
      amount: drink[`strMeasure${index}`]?.trim() || null,
    });
  }

  if (ingredients.length === 0) return null;
  const sourceId = String(drink.idDrink).trim();

  return {
    sourceId,
    sourceUrl: `https://www.thecocktaildb.com/drink/${encodeURIComponent(sourceId)}`,
    name: drink.strDrink.trim(),
    instructions: drink.strInstructions.trim(),
    glassware: drink.strGlass?.trim() || null,
    imageUrl: drink.strDrinkThumb?.trim() || null,
    ingredients,
  };
}

async function insertDrink(client, drink) {
  const cocktail = await client.query(
    `INSERT INTO cocktails (name, instructions, glassware, image_url, source_id, source_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [drink.name, drink.instructions, drink.glassware, drink.imageUrl, drink.sourceId, drink.sourceUrl]
  );

  if (!cocktail.rows[0]) return false;

  for (const ingredient of drink.ingredients) {
    const insertedIngredient = await client.query(
      `INSERT INTO ingredients (name, category)
       VALUES ($1, 'Other')
       ON CONFLICT (name) DO UPDATE
         SET category = COALESCE(ingredients.category, EXCLUDED.category)
       RETURNING id`,
      [ingredient.name]
    );
    await client.query(
      `INSERT INTO cocktail_ingredients (cocktail_id, ingredient_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [cocktail.rows[0].id, insertedIngredient.rows[0].id, ingredient.amount]
    );
  }

  return true;
}

async function syncRecipes(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO recipe_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING'
    );
    const state = await client.query(
      'SELECT last_attempt_at FROM recipe_sync_state WHERE id = 1 FOR UPDATE'
    );

    const lastAttempt = state.rows[0]?.last_attempt_at;
    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < SYNC_INTERVAL_MS) {
      await client.query('COMMIT');
      return 0;
    }

    let added = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && added < MAX_RECIPES_PER_RUN; attempt += 1) {
      const drink = normalizeDrink(await fetchRandomDrink());
      if (drink && await insertDrink(client, drink)) added += 1;
    }

    await client.query('UPDATE recipe_sync_state SET last_attempt_at = NOW() WHERE id = 1');
    await client.query('COMMIT');
    return added;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startRecipeSync(pool) {
  const run = async () => {
    try {
      const added = await syncRecipes(pool);
      if (added > 0) console.log(`Imported ${added} new cocktail recipe(s) from TheCocktailDB`);
    } catch (error) {
      console.error('Automatic recipe sync failed:', error.message);
    }
  };

  const startupSync = setTimeout(run, 5000);
  const dailySync = setInterval(run, SYNC_INTERVAL_MS);
  startupSync.unref();
  dailySync.unref();
}

module.exports = { startRecipeSync };
