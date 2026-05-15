import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';

const MEAL_ICONS = {
  breakfast: { icon: 'white-balance-sunny', color: '#FEF3C7', iconColor: '#D97706' },
  morningSnack: { icon: 'apple', color: '#DCFCE7', iconColor: '#16A34A' },
  lunch: { icon: 'food-fork-drink', color: '#FFEDD5', iconColor: '#EA580C' },
  afternoonSnack: { icon: 'cup-water', color: '#E0F2FE', iconColor: '#0284C7' },
  dinner: { icon: 'food-steak', color: '#F3E8FF', iconColor: '#9333EA' },
};

const MealPlanScreen = ({ navigation }) => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const [refreshing, setRefreshing] = useState(false);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const fetchData = useCallback(async () => {
    try {
      const residentId = await getResidentId();

      // Fetch saved meal plan (read-only — caretaker generates the plan)
      const planRes = await apiFetch(`/residents/${residentId}/meal-plan`);
      if (planRes.ok) {
        const planData = await planRes.json();
        if (planData.plan) {
          setPlan(planData.plan);
        }
      }
    } catch (err) {
      console.error('[MealPlan] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Get current day's meals
  const currentDayKey = days[selectedDay];
  const dayMeals = plan?.days?.[currentDayKey]?.meals || [];
  const clinicalNotes = plan?.clinicalNotes || [];
  const nutrition = plan?.nutrition || { calories: '—', protein: '—', carbs: '—', fat: '—' };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#F97316" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Meal Plan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} colors={['#F97316']} />}
      >
        {/* Banner */}
        <View style={styles.bannerCard}>
          <View>
            <Text style={styles.bannerTitle}>AI Curated Diet</Text>
            <Text style={styles.bannerSubtitle}>
              {plan ? 'Prepared by your caretaker' : 'Optimized for your prescriptions'}
            </Text>
          </View>
          <MaterialCommunityIcons name="brain" size={32} color="#FFFFFF" opacity={0.8} />
        </View>

        {!plan ? (
          /* No plan yet — inform patient */
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="silverware-fork-knife" size={48} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>No Meal Plan Yet</Text>
            <Text style={styles.emptySubtitle}>
              Your caretaker will generate a personalized meal plan based on your medications.
            </Text>
          </View>
        ) : (
          <>
            {/* Clinical Considerations */}
            {clinicalNotes.length > 0 && (
              <View style={styles.clinicalCard}>
                <View style={styles.clinicalHeader}>
                  <MaterialCommunityIcons name="flask-outline" size={18} color="#B45309" />
                  <Text style={styles.clinicalTitle}> Clinical Considerations</Text>
                </View>
                {clinicalNotes.map((note, index) => (
                  <Text key={index} style={styles.clinicalNote}>• {note}</Text>
                ))}
              </View>
            )}

            {/* Day Selector */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daySelector}>
              {days.map((day, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  style={[styles.dayBtn, selectedDay === idx && styles.dayBtnActive]}
                  onPress={() => setSelectedDay(idx)}
                >
                  <Text style={[styles.dayText, selectedDay === idx && styles.dayTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Nutrition Summary */}
            <View style={styles.nutritionGrid}>
              <View style={styles.nutritionBox}><Text style={styles.nutriLabel}>CALS</Text><Text style={styles.nutriValue}>{nutrition.calories}</Text></View>
              <View style={styles.nutritionBox}><Text style={styles.nutriLabel}>PRO</Text><Text style={styles.nutriValue}>{nutrition.protein}</Text></View>
              <View style={styles.nutritionBox}><Text style={styles.nutriLabel}>CARB</Text><Text style={styles.nutriValue}>{nutrition.carbs}</Text></View>
              <View style={styles.nutritionBox}><Text style={styles.nutriLabel}>FAT</Text><Text style={styles.nutriValue}>{nutrition.fat}</Text></View>
            </View>

            {/* Meals List */}
            <View style={styles.mealsList}>
              {dayMeals.map((meal) => {
                const mealStyle = MEAL_ICONS[meal.id] || MEAL_ICONS.lunch;
                return (
                  <View key={meal.id} style={[styles.mealCard, { backgroundColor: mealStyle.color }]}>
                    <View style={styles.mealHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialCommunityIcons name={mealStyle.icon} size={16} color={mealStyle.iconColor} style={{ marginRight: 4 }} />
                        <Text style={styles.mealLabel}>{meal.label}</Text>
                      </View>
                      <View style={styles.calBadge}>
                        <Text style={styles.calText}>{meal.calories} cal</Text>
                      </View>
                    </View>

                    <Text style={styles.mealName}>{meal.name}</Text>
                    <Text style={styles.mealDesc}>{meal.description}</Text>

                    {meal.rationale ? (
                      <View style={styles.rationaleBox}>
                        <MaterialCommunityIcons name="information" size={14} color="#3B82F6" style={{ marginTop: 2 }} />
                        <Text style={styles.rationaleText}>{meal.rationale}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9'
  },
  backBtn: { padding: 8, backgroundColor: '#F1F5F9', borderRadius: 20 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B' },

  scrollContainer: { padding: 20, paddingBottom: 40 },

  bannerCard: {
    backgroundColor: '#F97316', borderRadius: 20, padding: 20, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4
  },
  bannerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
  bannerSubtitle: { fontSize: 13, color: '#FFEDD5', fontWeight: '500' },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#64748B', marginTop: 16, marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#94A3B8', marginBottom: 20, textAlign: 'center', paddingHorizontal: 20 },

  clinicalCard: { backgroundColor: '#FEF3C7', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#FDE68A' },
  clinicalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  clinicalTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  clinicalNote: { fontSize: 13, color: '#B45309', marginBottom: 4 },

  daySelector: { marginBottom: 20 },
  dayBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, marginRight: 8, backgroundColor: '#F1F5F9' },
  dayBtnActive: { backgroundColor: '#FFEDD5' },
  dayText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  dayTextActive: { color: '#C2410C' },

  nutritionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  nutritionBox: { backgroundColor: '#FFFFFF', paddingVertical: 12, borderRadius: 16, flex: 1, alignItems: 'center', marginHorizontal: 4, borderWidth: 1, borderColor: '#F1F5F9' },
  nutriLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', marginBottom: 4 },
  nutriValue: { fontSize: 16, fontWeight: '800', color: '#1E293B' },

  mealsList: { gap: 12 },
  mealCard: { borderRadius: 20, padding: 16 },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mealLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  calBadge: { backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  calText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  
  mealName: { fontSize: 16, fontWeight: '800', color: '#1E293B', marginBottom: 4 },
  mealDesc: { fontSize: 13, color: '#475569', marginBottom: 8 },
  
  rationaleBox: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.6)', padding: 8, borderRadius: 8, alignItems: 'flex-start' },
  rationaleText: { fontSize: 12, color: '#1E40AF', marginLeft: 4, flex: 1 },
});

export default MealPlanScreen;
