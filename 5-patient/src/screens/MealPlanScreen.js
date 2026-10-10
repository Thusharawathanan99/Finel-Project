import { normalizeMealPlan } from '../mealPlanAdapter';
import RequestError from '../components/RequestError';
import { useScreenRefresh } from '../useScreenRefresh';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch, getResidentId } from '../apiHelper';

const MEAL_ICONS = {
  breakfast: { icon: 'white-balance-sunny', color: '#FEF3C7', iconColor: '#D97706' },
  morningSnack: { icon: 'apple', color: '#DCFCE7', iconColor: '#16A34A' },
  lunch: { icon: 'food-fork-drink', color: '#FFEDD5', iconColor: '#EA580C' },
  afternoonSnack: { icon: 'cup-water', color: '#E4F3ED', iconColor: '#075E55' },
  dinner: { icon: 'food-steak', color: '#F3E8FF', iconColor: '#9333EA' },
};

const MealPlanScreen = ({ navigation }) => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const [refreshing, setRefreshing] = useState(false);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const residentId = await getResidentId();

      // Fetch saved meal plan (read-only — caretaker generates the plan)
      const planRes = await apiFetch(`/residents/${residentId}/meal-plan`);
      if (!planRes.ok) throw new Error('Meal plan unavailable');
      if (planRes.ok) {
        const planData = await planRes.json();
        setPlan(normalizeMealPlan(planData.plan));
      }
    } catch (err) {
      setLoadError('We could not load your care records. Check your connection and try again.');
      console.error('[MealPlan] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useScreenRefresh(navigation, fetchData);

  // Get current day's meals
  const currentDayKey = days[selectedDay];
  const dayMeals = plan?.days?.[currentDayKey]?.meals || [];
  const clinicalNotes = plan?.clinicalNotes || [];
  const nutrition = plan?.days?.[currentDayKey]?.nutrition || plan?.nutrition || { calories: '—', protein: '—', carbs: '—', fat: '—' };

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
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Dashboard')} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Meal Plan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} colors={["#6D38FF"]} />}
      >
        <RequestError message={loadError} onRetry={fetchData} />
        {/* Banner */}
        <View style={styles.bannerCard}>
          <View pointerEvents="none" style={styles.heroOrb} />
          <View pointerEvents="none" style={styles.heroOrbSmall} />
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>NOURISH YOUR EVERYDAY</Text>
            <Text style={styles.bannerTitle}>AI Curated Diet</Text>
            <Text style={styles.bannerSubtitle}>
              {plan ? 'Prepared by your caretaker' : 'Optimized for your prescriptions'}
            </Text>
          </View>
          <MaterialCommunityIcons name="brain" size={40} color="#FFB85C" opacity={1} />
        </View>

        {!loadError && !plan ? (
          /* No plan yet — inform patient */
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="silverware-fork-knife" size={48} color="#A2A4C3" />
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
                    {Array.isArray(meal.warnings) && meal.warnings.map((warning,index)=><Text key={index} style={{color:'#991B1B',marginTop:6}}>⚠ {warning}</Text>)}

                    {meal.rationale ? (
                      <View style={styles.rationaleBox}>
                        <MaterialCommunityIcons name="information" size={14} color="#5355B7" style={{ marginTop: 2 }} />
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
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5FF"
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: "#F6F5FF",
    borderBottomWidth: 0,
    borderBottomColor: "#EEE9FF"
  },
  backBtn: {
    minHeight: 44,
    minWidth: 44,
    padding: 8,
    backgroundColor: "#EEE9FF",
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    height: 46
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    lineHeight: 27,
    letterSpacing: -0.7
  },
  scrollContainer: {
    padding: 20,
    paddingBottom: 44
  },
  bannerCard: {
    backgroundColor: "#171459",
    borderRadius: 32,
    padding: 24,
    marginBottom: 26,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: "#171459",
    shadowOffset: {
      width: 0,
      height: 4
    },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 5,
    minHeight: 178,
    borderWidth: 0,
    overflow: "hidden"
  },
  bannerTitle: {
    fontSize: 29,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 9,
    lineHeight: 34,
    letterSpacing: -1
  },
  bannerSubtitle: {
    fontSize: 14,
    color: "#DAD9FF",
    fontWeight: "500",
    lineHeight: 22
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
    borderColor: "#E4E3F4",
    borderRadius: 30,
    padding: 26,
    marginTop: 12
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#171459",
    marginTop: 16,
    marginBottom: 4,
    lineHeight: 27,
    letterSpacing: -0.4
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6B6F91",
    marginBottom: 20,
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 23
  },
  clinicalCard: {
    backgroundColor: "#FFF0EC",
    borderRadius: 25,
    padding: 18,
    marginBottom: 20,
    borderWidth: 0,
    borderColor: '#FDE68A'
  },
  clinicalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  clinicalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: "#8F3D37",
    lineHeight: 21
  },
  clinicalNote: {
    fontSize: 13,
    color: "#8F3D37",
    marginBottom: 7,
    lineHeight: 21
  },
  daySelector: {
    marginBottom: 20
  },
  dayBtn: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 18,
    marginRight: 8,
    backgroundColor: "#FFFFFF",
    minHeight: 52,
    minWidth: 54,
    justifyContent: "center",
    alignItems: "center"
  },
  dayBtnActive: {
    backgroundColor: "#171459"
  },
  dayText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B6F91"
  },
  dayTextActive: {
    color: "#FFFFFF"
  },
  nutritionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 22,
    gap: 7
  },
  nutritionBox: {
    backgroundColor: "#EEE9FF",
    paddingVertical: 17,
    borderRadius: 20,
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 0,
    borderWidth: 0,
    borderColor: "#EEE9FF",
    paddingHorizontal: 3
  },
  nutriLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: "#6B6F91",
    marginBottom: 8,
    letterSpacing: 1.2
  },
  nutriValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#171459"
  },
  mealsList: {
    gap: 16
  },
  mealCard: {
    borderRadius: 28,
    padding: 20
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 13,
    flexWrap: "wrap",
    gap: 8
  },
  mealLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: "#626786",
    textTransform: 'uppercase',
    letterSpacing: 1.2
  },
  calBadge: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12
  },
  calText: {
    fontSize: 11,
    fontWeight: '700',
    color: "#626786"
  },
  mealName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#171459",
    marginBottom: 6,
    lineHeight: 28,
    letterSpacing: -0.6
  },
  mealDesc: {
    fontSize: 14,
    color: "#626786",
    marginBottom: 14,
    lineHeight: 22
  },
  rationaleBox: {
    flexDirection: 'row',
    backgroundColor: "rgba(255,255,255,0.72)",
    padding: 13,
    borderRadius: 18,
    alignItems: 'flex-start'
  },
  rationaleText: {
    fontSize: 12,
    color: "#5355B7",
    marginLeft: 7,
    flex: 1,
    lineHeight: 20
  },
  closeBtn: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "#EEE9FF"
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginBottom: 16
  },
  listContainer: {
    gap: 16
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    color: "#BEBEFF",
    letterSpacing: 2,
    marginBottom: 13
  },
  heroOrb: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    top: -68,
    right: -46,
    backgroundColor: "#6D38FF",
    opacity: 0.24
  },
  heroOrbSmall: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    right: 35,
    bottom: -38,
    backgroundColor: "#FFB85C",
    opacity: 0.72
  },
  submitBtn: {
    backgroundColor: "#171459",
    borderRadius: 20,
    minHeight: 56,
    shadowColor: "#171459",
    shadowOpacity: 0.12
  },
  confirmBtn: {
    backgroundColor: "#171459",
    borderRadius: 20,
    minHeight: 56
  }
});

export default MealPlanScreen;
