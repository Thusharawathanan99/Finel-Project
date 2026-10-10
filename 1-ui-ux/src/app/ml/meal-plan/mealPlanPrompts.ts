/**
 * Gemini Prompt Templates for Meal Plan Generation
 * Structured prompts for clinical nutrition-aware meal planning.
 */

/**
 * System prompt that establishes Gemini as a clinical nutritionist.
 */
export const MEAL_PLAN_SYSTEM_PROMPT = `Suggest meal options for review by caregivers and clinicians. Do not claim medical certification. You create personalized meal plans for healthcare facility residents.

KEY PRINCIPLES:
1. SAFETY FIRST — Never suggest foods that have dangerous interactions with the patient's medications
2. Consider the patient's age, medical conditions, and allergies when planning meals
3. Ensure adequate caloric intake appropriate for the patient's age and condition
4. Balance macronutrients (protein, carbs, fats) across all meals
5. Use only supplied medical history; do not infer or diagnose diseases from medication names. Ingredient and nutrient estimates require professional verification.
6. Include culturally diverse options that are practical for institutional meal preparation
7. Provide clear rationale for each food choice, especially medication-related considerations

CRITICAL DRUG-FOOD INTERACTIONS TO ALWAYS CHECK:
- Warfarin: Limit vitamin K-rich foods (spinach, kale, broccoli) — maintain consistency
- Metformin: Prefer low-glycemic foods, avoid excessive alcohol and refined sugars
- Lisinopril/ACE Inhibitors: Low sodium diet, avoid potassium-heavy foods in excess
- Statins (Atorvastatin, etc.): Avoid grapefruit and grapefruit juice
- MAOIs: Avoid tyramine-rich foods (aged cheese, cured meats, soy sauce)
- Levothyroxine: Avoid calcium-rich foods and coffee within 4 hours of dosing
- Methotrexate: Avoid alcohol, ensure adequate folate
- Diuretics: May need potassium-rich foods (bananas, oranges) unless potassium-sparing
- Iron supplements: Take with vitamin C; avoid dairy at same meal
- Tetracyclines / Fluoroquinolones: Avoid dairy products within 2 hours`;

/**
 * Build the user prompt with resident context.
 */
export function buildMealPlanPrompt(context: {
  name: string;
  age: number;
  medications: { name: string; dosage: string; frequency: string }[];
  allergies: string[];
  medicalHistory: string;
  dietaryRestrictions: string[];
  calorieTarget?: number;
}): string {
  const medList = context.medications.length > 0
    ? context.medications.map(m => `- ${m.name} ${m.dosage} (${m.frequency})`).join('\n')
    : '- None currently prescribed';

  const allergyList = context.allergies.length > 0
    ? context.allergies.join(', ')
    : 'No known allergies';

  const dietList = context.dietaryRestrictions.length > 0
    ? context.dietaryRestrictions.join(', ')
    : 'No specific restrictions';

  const calories = context.calorieTarget || 2000;

  return `Generate a complete 7-day meal plan (Monday through Sunday, every day exactly once) for the following patient:

PATIENT PROFILE:
- Name: ${context.name}
- Age: ${context.age} years
- Medical History: ${context.medicalHistory || 'Not specified'}

CURRENT MEDICATIONS:
${medList}

ALLERGIES: ${allergyList}
DIETARY RESTRICTIONS: ${dietList}
DAILY CALORIE TARGET: ~${calories} kcal

Generate a JSON response with this EXACT structure (no extra text, just JSON):
{
  "days": [
    {
      "day": "Monday",
      "breakfast": {
        "name": "Oatmeal with Berries",
        "description": "Steel-cut oats topped with fresh blueberries and a drizzle of honey",
        "ingredients": ["steel-cut oats", "blueberries", "honey"],
        "calories": 320,
        "protein": 10,
        "carbs": 55,
        "fat": 6,
        "fiber": 8,
        "rationale": "Low-glycemic complex carbs suitable for Metformin therapy",
        "warnings": [],
        "tags": ["low-glycemic", "high-fiber"]
      },
      "morningSnack": { ... },
      "lunch": { ... },
      "afternoonSnack": { ... },
      "dinner": { ... },
      "totalCalories": 1950,
      "totalProtein": 75,
      "totalCarbs": 250,
      "totalFat": 65
    }
  ],
  "dietaryNotes": "Guidance based only on the supplied medical history. Verify ingredients and estimated nutrients before use.",
  "medicationConsiderations": [
    "Avoid grapefruit due to Atorvastatin interaction",
    "Low-sodium meals due to Lisinopril for blood pressure management"
  ],
  "calorieTarget": ${calories},
  "specialDiet": ["low-sodium", "diabetic-friendly"]
}

IMPORTANT: Return ONLY the JSON, no other text.`;
}

/**
 * Prompt for regenerating a single meal.
 */
export function buildMealRegenerationPrompt(
  mealType: string,
  day: string,
  currentMeal: string,
  medications: string[],
  allergies: string[],
  reason?: string,
  dietaryRestrictions: string[] = [],
  medicalHistory: string = '',
  calorieTarget: number = 2000
): string {
  return `The patient wants an alternative ${mealType} for ${day}. 
Current meal is: ${currentMeal}
${reason ? `Reason for change: ${reason}` : ''}

Medications: ${medications.join(', ') || 'None'}
Allergies: ${allergies.join(', ') || 'None'}
Dietary restrictions: ${dietaryRestrictions.join(', ') || 'None'}
Supplied medical history: ${medicalHistory || 'Not specified'}
Daily calorie target: ${calorieTarget}
Do not add any declared allergen or food excluded by these restrictions.

Generate a SINGLE replacement meal item as JSON:
{
  "name": "...",
  "description": "...",
  "ingredients": ["list every ingredient"],
  "calories": ...,
  "protein": ...,
  "carbs": ...,
  "fat": ...,
  "fiber": ...,
  "rationale": "...",
  "warnings": [],
  "tags": []
}

Return ONLY the JSON.`;
}
