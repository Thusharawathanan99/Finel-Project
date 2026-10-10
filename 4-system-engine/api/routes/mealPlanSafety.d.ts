export interface MealPlanningContext { residentId?: string; residentName?: string; name?: string; age?: number; medications: {name?: string; drugName?: string; dosage?: string; frequency?: string}[]; allergies: string[]; medicalHistory?: string; dietaryRestrictions: string[]; calorieTarget?: number; }
export interface CanonicalMealContext {residentId: string; residentName: string; age: number; medications: {name: string; dosage: string; frequency: string}[]; allergies: string[]; medicalHistory: string; dietaryRestrictions: string[]; calorieTarget: number;}
export function normalizeMealContext(input: MealPlanningContext): CanonicalMealContext;
export function mealPlanFingerprint(input: MealPlanningContext): string;
export function assertMealRestrictions(meal: unknown, context: MealPlanningContext): void;
export function validateMealItem<T>(meal: T, context: MealPlanningContext): T;
export function validateWeeklyMealPlan<T>(plan: T, context?: MealPlanningContext): T;
export const MEAL_DAYS: string[];
export const MEAL_SLOTS: string[];
