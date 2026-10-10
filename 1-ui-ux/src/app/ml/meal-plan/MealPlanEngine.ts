/** Meal generation remains unpublished until its full context and contents validate and save. */
import {isGeminiEnabled, callWithRetry} from '../nlp/geminiService';
import {WeeklyMealPlan, MealItem} from './MealPlan';
import {MEAL_PLAN_SYSTEM_PROMPT, buildMealPlanPrompt, buildMealRegenerationPrompt} from './mealPlanPrompts';
import {mealPlansApi} from '../../services/apiService';
import {mealPlanFingerprint, normalizeMealContext, validateWeeklyMealPlan, validateMealItem} from '../../../../../4-system-engine/api/routes/mealPlanSafety.js';
const mealPlanCache = new Map<string, {plan: WeeklyMealPlan; fingerprint: string; cachedAt: number}>();
let scopeGeneration = 0;
const residentGenerations = new Map<string, number>();
function captureGeneration(residentId: string) {
  const scope = scopeGeneration;
  const resident = residentGenerations.get(residentId) || 0;
  return () => {
    if (scope !== scopeGeneration || resident !== (residentGenerations.get(residentId) || 0)) throw new Error('The account or resident details changed. Please reload the current meal plan.');
  };
}
export interface MealPlanRequest {
  residentId: string; residentName: string; age: number;
  medications: {name: string; dosage: string; frequency: string}[];
  allergies: string[]; medicalHistory: string; dietaryRestrictions: string[]; calorieTarget?: number;
}
export async function loadSavedMealPlan(residentId: string, currentContext: MealPlanRequest | number): Promise<WeeklyMealPlan | null> {
  // A count cannot establish freshness. Legacy callers must regenerate with full current inputs.
  if (typeof currentContext === 'number') return null;
  const assertCurrentGeneration = captureGeneration(residentId);
  const context = normalizeMealContext({...currentContext, residentId});
  const fingerprint = mealPlanFingerprint(context);
  const cached = mealPlanCache.get(residentId);
  if (cached?.fingerprint === fingerprint && Date.now() - cached.cachedAt < 15 * 60 * 1000) return cached.plan;
  mealPlanCache.delete(residentId);
  const response = await mealPlansApi.getForResident(residentId);
  assertCurrentGeneration();
  if (!response.plan?.inputContext || response.plan.inputFingerprint !== fingerprint || mealPlanFingerprint(response.plan.inputContext) !== fingerprint) return null;
  const generatedAt = new Date(response.plan.generatedAt).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 60000 || Date.now() - generatedAt > 7 * 24 * 60 * 60 * 1000) return null;
  let plan: WeeklyMealPlan;
  try {plan = validateWeeklyMealPlan(response.plan, context);} catch {return null;}
  mealPlanCache.set(residentId, {plan, fingerprint, cachedAt: Date.now()});
  return plan;
}
export async function generateMealPlan(request: MealPlanRequest): Promise<WeeklyMealPlan> {
  const assertCurrentGeneration = captureGeneration(request.residentId);
  if (!isGeminiEnabled()) throw new Error('Meal planning service is unavailable. Please try again later.');
  normalizeMealContext(request);
  const prompt = buildMealPlanPrompt({name: request.residentName, age: request.age, medications: request.medications, allergies: request.allergies,
    medicalHistory: request.medicalHistory, dietaryRestrictions: request.dietaryRestrictions, calorieTarget: request.calorieTarget});
  const result = await callWithRetry(model => model.generateContent([{text: MEAL_PLAN_SYSTEM_PROMPT}, {text: prompt}]), {task: 'meal-plan'});
  assertCurrentGeneration();
  const match = result.response.text().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Meal response did not contain valid JSON.');
  const parsed = JSON.parse(match[0]);
  const draft: WeeklyMealPlan = {residentId: request.residentId, residentName: request.residentName, generatedAt: new Date(), days: parsed.days,
    dietaryNotes: parsed.dietaryNotes, medicationConsiderations: parsed.medicationConsiderations, calorieTarget: request.calorieTarget || 2000, specialDiet: request.dietaryRestrictions};
  // Validation errors deliberately propagate; a raw draft must never be saved as a fallback.
  const plan = validateWeeklyMealPlan(draft, request);
  assertCurrentGeneration();
  await mealPlansApi.save(request.residentId, plan, request.medications.length);
  assertCurrentGeneration();
  mealPlanCache.set(request.residentId, {plan, fingerprint: mealPlanFingerprint(request), cachedAt: Date.now()});
  return plan;
}
export async function regenerateMeal(plan: WeeklyMealPlan, dayIndex: number, mealType: 'breakfast' | 'morningSnack' | 'lunch' | 'afternoonSnack' | 'dinner', reason?: string): Promise<MealItem> {
  const assertCurrentGeneration = captureGeneration(plan.residentId);
  if (!isGeminiEnabled()) throw new Error('Meal planning service is unavailable.');
  if (!plan.inputContext || plan.inputFingerprint !== mealPlanFingerprint(plan.inputContext)) throw new Error('Regenerate this plan with current resident details before replacing a meal.');
  const context = normalizeMealContext(plan.inputContext);
  const day = plan.days[dayIndex];
  if (!day || !['breakfast', 'morningSnack', 'lunch', 'afternoonSnack', 'dinner'].includes(mealType)) throw new Error('Invalid meal selection.');
  const prompt = buildMealRegenerationPrompt(mealType, day.day, day[mealType].name,
    context.medications.map(m => `${m.name} ${m.dosage} (${m.frequency})`), context.allergies, reason, context.dietaryRestrictions, context.medicalHistory, context.calorieTarget);
  const result = await callWithRetry(model => model.generateContent([{text: MEAL_PLAN_SYSTEM_PROMPT}, {text: prompt}]), {task: 'meal-plan'});
  assertCurrentGeneration();
  const match = result.response.text().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Meal response did not contain valid JSON.');
  const replacement = validateMealItem(JSON.parse(match[0]) as MealItem, context);
  const updated: WeeklyMealPlan = {...plan, days: plan.days.map(item => ({...item}))};
  updated.days[dayIndex][mealType] = replacement;
  const validated = validateWeeklyMealPlan(updated, context);
  assertCurrentGeneration();
  await mealPlansApi.save(plan.residentId, validated, context.medications.length);
  assertCurrentGeneration();
  plan.days = validated.days;
  mealPlanCache.set(plan.residentId, {plan, fingerprint: mealPlanFingerprint(context), cachedAt: Date.now()});
  return replacement;
}
export function clearMealPlanCache(residentId: string): void {
  residentGenerations.set(residentId, (residentGenerations.get(residentId) || 0) + 1);
  mealPlanCache.delete(residentId);
}
export function clearAllMealPlanCaches(): void {
  scopeGeneration++;
  residentGenerations.clear();
  mealPlanCache.clear();
}
