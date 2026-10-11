// Pure validation for generated meal plans; this does not certify clinical suitability.
export const MEAL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MEAL_SLOTS = ['breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner'];
const text = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const absent = value => /^(?:none|no known allergies|n\/a|not specified)$/i.test(value);
export function normalizeMealContext(input) {
  if (!input || typeof input !== 'object') throw new Error('Complete resident planning context is required.');
  if (!Array.isArray(input.medications) || !Array.isArray(input.allergies) || !Array.isArray(input.dietaryRestrictions)) throw new Error('Medications, allergies, and dietary restrictions must be lists.');
  const medications = input.medications.map(m => {
    const name = text(m?.name || m?.drugName);
    if (!name) throw new Error('Each medication needs a name.');
    return {name, dosage: text(m.dosage), frequency: text(m.frequency), instructions: text(m.instructions), route: text(m.route)};
  });
  const calorieTarget = input.calorieTarget === undefined ? 2000 : input.calorieTarget;
  if (typeof calorieTarget !== 'number' || !Number.isFinite(calorieTarget) || calorieTarget <= 0 || calorieTarget > 10000) throw new Error('Calorie target must be a positive number.');
  return {residentId: text(input.residentId), residentName: text(input.residentName || input.name), age: Number.isFinite(input.age) ? input.age : 0,
    medications, allergies: list(input.allergies).filter(a => !absent(a)), medicalHistory: text(input.medicalHistory),
    dietaryRestrictions: list(input.dietaryRestrictions).filter(a => !absent(a)), calorieTarget};
}
export function mealPlanFingerprint(input) {
  const c = normalizeMealContext(input);
  const normalize = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
  // Compare all relevant inputs, including same-count regimen changes. No count-only fallback.
  return JSON.stringify({version: 1, residentId: c.residentId, age: c.age,
    medications: c.medications.map(m => [normalize(m.name), normalize(m.dosage), normalize(m.frequency), normalize(m.instructions || ''), normalize(m.route || '')]).sort(),
    allergies: c.allergies.map(normalize).sort(), medicalHistory: normalize(c.medicalHistory), dietaryRestrictions: c.dietaryRestrictions.map(normalize).sort(), calorieTarget: c.calorieTarget});
}
const ALLERGENS = {
  peanut: ['peanut', 'groundnut'], almond: ['almond'], walnut: ['walnut'], cashew: ['cashew'],
  'tree nut': ['almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
  nut: ['peanut', 'groundnut', 'almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'macadamia'],
  milk: ['milk', 'dairy', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'whey', 'casein'],
  dairy: ['milk', 'dairy', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'whey', 'casein'],
  egg: ['egg', 'mayonnaise'], soy: ['soy', 'soya', 'tofu', 'tempeh', 'edamame'],
  wheat: ['wheat', 'semolina', 'couscous', 'bulgur'], gluten: ['wheat', 'barley', 'rye', 'semolina', 'couscous', 'bulgur'],
  sesame: ['sesame', 'tahini'], fish: ['fish', 'salmon', 'tuna', 'cod', 'sardine', 'anchovy'],
  shellfish: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster'],
};
const meat = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'turkey', 'duck', 'bacon', 'ham', 'sausage', 'gelatin'];
function hasFood(contents, term) {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\b`, 'i').test(contents);
}
export function assertMealRestrictions(meal, context) {
  const c = normalizeMealContext(context);
  const contents = [meal?.name, meal?.description, ...list(meal?.ingredients)].join(' ').toLowerCase();
  for (const allergy of c.allergies) {
    const key = allergy.toLowerCase().replace(/[-_]/g, ' ');
    const terms = Object.entries(ALLERGENS).filter(([term]) => hasFood(key, term)).flatMap(([, aliases]) => aliases);
    if (!terms.length) terms.push(key);
    if (terms.some(term => hasFood(contents, term))) throw new Error(`Meal contains a declared allergen (${allergy}).`);
  }
  const diet = c.dietaryRestrictions.join(' ').toLowerCase();
  let excluded = [];
  if (/\b(?:vegan|vegetarian)\b/.test(diet)) excluded.push(...meat, ...ALLERGENS.fish, ...ALLERGENS.shellfish);
  if (/\bvegan\b/.test(diet)) excluded.push(...ALLERGENS.dairy, ...ALLERGENS.egg, 'honey');
  if (/\bpescatarian\b/.test(diet)) excluded.push(...meat);
  if (/gluten[ -]?free/.test(diet)) excluded.push(...ALLERGENS.gluten);
  if (/(?:dairy|milk)[ -]?free/.test(diet)) excluded.push(...ALLERGENS.dairy);
  if (/nut[ -]?free/.test(diet)) excluded.push(...ALLERGENS.nut);
  if (excluded.some(term => hasFood(contents, term))) throw new Error('Meal conflicts with a declared dietary restriction.');
}
export function validateMealItem(meal, context) {
  if (!meal || typeof meal !== 'object' || !text(meal.name) || !text(meal.description) || !text(meal.rationale)) throw new Error('Every meal needs a name, description, and rationale.');
  if (!Array.isArray(meal.ingredients) || !meal.ingredients.length || meal.ingredients.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Every meal needs a complete ingredient list.');
  for (const field of ['calories', 'protein', 'carbs', 'fat', 'fiber']) {
    const maximum = field === 'calories' ? 10000 : 1000;
    if (typeof meal[field] !== 'number' || !Number.isFinite(meal[field]) || meal[field] < 0 || meal[field] > maximum) throw new Error(`Invalid meal ${field}.`);
  }
  if (!Array.isArray(meal.warnings) || !Array.isArray(meal.tags) || [...meal.warnings, ...meal.tags].some(v => typeof v !== 'string')) throw new Error('Meal warnings and tags must be lists of text.');
  assertMealRestrictions(meal, context);
  return {...meal, name: text(meal.name), description: text(meal.description), ingredients: list(meal.ingredients)};
}
export function validateWeeklyMealPlan(plan, context = plan?.inputContext) {
  const c = normalizeMealContext(context);
  if (!Array.isArray(plan?.days) || plan.days.length !== 7 || new Set(plan.days.map(d => d?.day)).size !== 7 || plan.days.some(d => !MEAL_DAYS.includes(d?.day))) throw new Error('Meal plan needs seven distinct days, Monday through Sunday.');
  const days = MEAL_DAYS.map(day => {
    const value = {...plan.days.find(d => d.day === day)};
    for (const slot of MEAL_SLOTS) value[slot] = validateMealItem(value[slot], c);
    const meals = MEAL_SLOTS.map(slot => value[slot]);
    for (const [field, nutrient] of [['totalCalories', 'calories'], ['totalProtein', 'protein'], ['totalCarbs', 'carbs'], ['totalFat', 'fat']]) value[field] = meals.reduce((sum, meal) => sum + meal[nutrient], 0);
    return value;
  });
  if (typeof plan.dietaryNotes !== 'string' || !Array.isArray(plan.medicationConsiderations) || plan.medicationConsiderations.some(v => typeof v !== 'string')) throw new Error('Meal plan guidance is incomplete.');
  return {...plan, days, calorieTarget: c.calorieTarget, specialDiet: c.dietaryRestrictions, inputContext: c, inputFingerprint: mealPlanFingerprint(c),
    needsReview: true, reviewReasons: ['Generated meal plans and nutrition estimates require caregiver or clinician review; ingredient checks cannot certify allergy or medical suitability.']};
}
