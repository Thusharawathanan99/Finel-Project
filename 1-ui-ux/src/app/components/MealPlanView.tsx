import { useState, useEffect, useRef } from 'react';
import { loadSavedMealPlan, type MealPlanRequest } from '../ml/meal-plan/MealPlanEngine';
import { WeeklyMealPlan, DailyMealPlan } from '../ml/meal-plan/MealPlan';
import { Resident } from '../models/Resident';
import { Loader2, Info, Utensils, Beaker } from 'lucide-react';

interface MealPlanViewProps {
  resident: Resident;
  onGenerate?: () => Promise<WeeklyMealPlan | null>;
}

export function MealPlanView({ resident, onGenerate }: MealPlanViewProps) {
  const [mealPlan, setMealPlan] = useState<WeeklyMealPlan | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(0); // 0 = Monday, etc.

  const [generating, setGenerating] = useState(false);
  const requestVersion = useRef(0);

  const context: MealPlanRequest = {
    residentId:resident.residentId,residentName:resident.name,age:resident.age,
    medications:resident.getAllMedications().map(m=>({name:m.drugName,dosage:m.dosage,frequency:m.frequency})),
    allergies:resident.personalDetails.allergies||[],medicalHistory:resident.personalDetails.medicalHistory||'',
    dietaryRestrictions:resident.personalDetails.dietaryRestrictions||[],
  };
  const contextVersion = JSON.stringify(context);

  /**
   * Load meal plan from DB only (read-only for patients).
   * Caretaker generates plans; patient can only view.
   */
  const loadMealPlan = async (version: number) => {
    setLoading(true);
    setError(null);
    setMealPlan(null);
    setSelectedDay(0);
    try {
      const savedPlan = await loadSavedMealPlan(resident.residentId, context);
      if (version !== requestVersion.current) return;
      setMealPlan(savedPlan);
      setLoading(false);
    } catch (err: any) {
      if (version !== requestVersion.current) return;
      console.error('Failed to load meal plan:', err);
      setError(err?.message || 'Failed to load meal plan');
      setLoading(false);
    }
  };

  useEffect(() => {
    const version = ++requestVersion.current;
    setGenerating(false);
    void loadMealPlan(version);
    return () => { requestVersion.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident.residentId, contextVersion]);

  const handleGenerate = async () => {
    if (!onGenerate || generating) return;
    const version = ++requestVersion.current;
    setGenerating(true);
    setError(null);
    try {
      const plan = await onGenerate();
      if (version !== requestVersion.current) return;
      if (!plan) throw new Error('Meal plan could not be generated. Please try again.');
      setMealPlan(plan);
      setSelectedDay(0);
    } catch (error) {
      if (version !== requestVersion.current) return;
      setError(error instanceof Error ? error.message : 'Meal plan could not be saved. Please try again.');
    } finally {
      if (version === requestVersion.current) setGenerating(false);
    }
  };

  const generationControls = onGenerate && <button type="button" onClick={handleGenerate} disabled={generating} className="w-full rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50">{generating ? 'Preparing and saving...' : mealPlan ? 'Generate New Meal Plan' : 'Generate Meal Plan'}</button>;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
        <Loader2 className="w-10 h-10 text-orange-500 animate-spin mb-4" />
        <p className="text-gray-800 font-medium">Loading Meal Plan...</p>
        <p className="text-sm text-gray-500 mt-2 text-center max-w-sm">
          Checking for a saved meal plan for {resident.name}.
        </p>
      </div>
    );
  }

  if (!mealPlan) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <Utensils className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-gray-800 mb-2">No Meal Plan Available</h3>
        <p className="text-gray-500">{onGenerate ? 'Generate a personalized meal plan based on current medications.' : 'Your caretaker will generate a personalized meal plan based on your medications.'}</p>
        {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
        <div className="mt-4">{generationControls}</div>
      </div>
    );
  }

  const dayPlan: DailyMealPlan | undefined = mealPlan.days[selectedDay];

  return (
    <div className="space-y-4">
      <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Review this proposed plan, its ingredients and medication guidance with your care team before using it.</p>
      {generationControls}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {/* Header section */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl shadow-md p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Utensils className="w-5 h-5" />
          Therapeutic Meal Plan
        </h2>
        <p className="text-sm text-orange-100 mt-1">Prepared for {resident.name} by your caretaker</p>
      </div>

      {/* Medication & Clinical warnings */}
      {(mealPlan.medicationConsiderations?.length > 0 || mealPlan.dietaryNotes) && (
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
          <h3 className="font-semibold text-amber-800 flex items-center gap-2 mb-2 text-sm">
            <Beaker className="w-4 h-4" /> Clinical Considerations
          </h3>
          {mealPlan.dietaryNotes && (
            <p className="text-sm text-amber-700 font-medium mb-2">{mealPlan.dietaryNotes}</p>
          )}
          <ul className="space-y-1">
            {mealPlan.medicationConsiderations.map((note, idx) => (
              <li key={idx} className="text-xs text-amber-700 flex items-start gap-1.5">
                <span className="mt-0.5">•</span> <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Day Selector */}
      <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto p-1 hide-scrollbar">
        {mealPlan.days.map((day, idx) => (
          <button
            key={idx}
            onClick={() => setSelectedDay(idx)}
            className={`min-w-[80px] flex-1 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap px-3 ${
              selectedDay === idx 
                ? 'bg-orange-100 text-orange-700' 
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {day.day.substring(0, 3)}
          </button>
        ))}
      </div>

      {/* Daily Plan View */}
      {dayPlan && (
        <div className="space-y-4">
          {/* Nutrition Summary */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
              <span className="block text-xs text-gray-500 uppercase">Cals</span>
              <span className="block text-lg font-bold text-gray-800">{dayPlan.totalCalories}</span>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
              <span className="block text-xs text-gray-500 uppercase">Protein</span>
              <span className="block text-lg font-bold text-gray-800">{dayPlan.totalProtein}g</span>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
              <span className="block text-xs text-gray-500 uppercase">Carbs</span>
              <span className="block text-lg font-bold text-gray-800">{dayPlan.totalCarbs}g</span>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-center">
              <span className="block text-xs text-gray-500 uppercase">Fat</span>
              <span className="block text-lg font-bold text-gray-800">{dayPlan.totalFat}g</span>
            </div>
          </div>

          {/* Meals List */}
          <div className="space-y-3">
            {[
              { id: 'breakfast', label: 'Breakfast', meal: dayPlan.breakfast, color: 'bg-yellow-50', icon: '🌅' },
              { id: 'morningSnack', label: 'Morning Snack', meal: dayPlan.morningSnack, color: 'bg-green-50', icon: '🍎' },
              { id: 'lunch', label: 'Lunch', meal: dayPlan.lunch, color: 'bg-orange-50', icon: '🍲' },
              { id: 'afternoonSnack', label: 'Afternoon Snack', meal: dayPlan.afternoonSnack, color: 'bg-teal-50', icon: '🥨' },
              { id: 'dinner', label: 'Dinner', meal: dayPlan.dinner, color: 'bg-purple-50', icon: '🍽️' },
            ].map(({ id, label, meal, color, icon }) => (
              <div key={id} className={`rounded-xl p-4 shadow-sm border ${color.replace('bg-', 'border-').replace('50', '200')} ${color}`}>
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                    <span>{icon}</span> {label}
                  </span>
                  <span className="text-xs font-medium bg-black/5 px-2 py-0.5 rounded-full">{meal.calories} cal</span>
                </div>
                
                <h4 className="font-bold text-gray-800 text-base leading-tight mb-1">{meal.name}</h4>
                <p className="text-sm text-gray-600 mb-2">{meal.description}</p>
                
                {meal.rationale && (
                  <div className="mt-2 bg-white/60 rounded p-2 text-xs text-gray-700 flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 mt-0.5 text-teal-500 flex-shrink-0" />
                    <span>{meal.rationale}</span>
                  </div>
                )}
                
                {meal.tags && meal.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {meal.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-white text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
