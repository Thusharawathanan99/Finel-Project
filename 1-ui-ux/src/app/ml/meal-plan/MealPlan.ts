import type { MealPlanningContext } from '../../../../../4-system-engine/api/routes/mealPlanSafety.js';
/**
 * Meal Plan Data Models
 * TypeScript interfaces for structured meal plan data returned by Gemini.
 */

export interface MealItem {
  ingredients?: string[];
  name: string;
  description: string;
  calories: number;
  protein: number;        // grams
  carbs: number;          // grams
  fat: number;            // grams
  fiber: number;          // grams
  rationale: string;      // "Low-glycemic due to Metformin"
  warnings: string[];     // Drug-food interaction alerts
  tags: string[];         // ["low-sodium", "high-fiber", "diabetic-friendly"]
}

export interface DailyMealPlan {
  day: string;            // "Monday", "Tuesday", etc.
  date?: Date;
  breakfast: MealItem;
  morningSnack: MealItem;
  lunch: MealItem;
  afternoonSnack: MealItem;
  dinner: MealItem;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
}

export interface WeeklyMealPlan {
  inputContext?: MealPlanningContext;
  inputFingerprint?: string;
  needsReview?: boolean;
  reviewReasons?: string[];
  residentId: string;
  residentName: string;
  generatedAt: Date;
  days: DailyMealPlan[];
  dietaryNotes: string;       // Overall nutritional guidance
  medicationConsiderations: string[]; // Key drug-food interactions to watch
  calorieTarget: number;
  specialDiet: string[];      // ["low-sodium", "diabetic", "vegetarian"]
}

/**
 * Create an empty meal plan structure.
 */
export function createEmptyMealPlan(residentId: string, residentName: string): WeeklyMealPlan {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const emptyMeal: MealItem = {
    name: '',
    description: '',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    rationale: '',
    warnings: [],
    tags: [],
  };

  return {
    residentId,
    residentName,
    generatedAt: new Date(),
    days: days.map(day => ({
      day,
      breakfast: { ...emptyMeal },
      morningSnack: { ...emptyMeal },
      lunch: { ...emptyMeal },
      afternoonSnack: { ...emptyMeal },
      dinner: { ...emptyMeal },
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
    })),
    dietaryNotes: '',
    medicationConsiderations: [],
    calorieTarget: 2000,
    specialDiet: [],
  };
}
