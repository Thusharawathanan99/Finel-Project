const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const LABELS = {breakfast:'Breakfast',morningSnack:'Morning Snack',lunch:'Lunch',afternoonSnack:'Afternoon Snack',dinner:'Dinner'};
const decoded = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return null; } };
export function normalizeMealPlan(input) {
  const plan = decoded(input); if (!plan || typeof plan !== 'object') return null;
  const original = decoded(plan.days) || [];
  const days = {};
  for (const [key, value] of Object.entries(original)) {
    const day = decoded(value) || {};
    const name = day.day || (/^\d+$/.test(key) ? DAY_NAMES[Number(key)] : key);
    if (!name) continue;
    const short = (DAY_NAMES.find(day => day.slice(0,3).toLowerCase() === name.slice(0,3).toLowerCase()) || name).slice(0,3);
    const meals = Array.isArray(day.meals) ? day.meals : Array.isArray(day) ? day : Object.entries(LABELS)
      .filter(([id]) => day[id]?.name).map(([id,label]) => ({...day[id],id,label}));
    days[short] = {meals: meals.map((meal,index) => ({...meal,id:meal.id || Object.keys(LABELS)[index] || String(index),label:meal.label || LABELS[meal.id] || 'Meal'})),nutrition:decoded(day.nutrition) || (day.totalCalories == null && day.totalProtein == null ? decoded(plan.nutrition) : null) || {calories:day.totalCalories ?? '—',protein:day.totalProtein ?? '—',carbs:day.totalCarbs ?? '—',fat:day.totalFat ?? '—'}};
  }
  const notes = Array.isArray(plan.medicationConsiderations) ? plan.medicationConsiderations : [];
  const clinical = Array.isArray(plan.clinicalNotes) ? plan.clinicalNotes : plan.clinicalNotes ? [String(plan.clinicalNotes)] : [];
  return {...plan,days,clinicalNotes:[...notes,...clinical,...(plan.dietaryNotes ? [plan.dietaryNotes] : [])],nutrition:decoded(plan.nutrition) || null};
}
