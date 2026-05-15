import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import DashboardScreen from '../screens/DashboardScreen';
import UploadRxScreen from '../screens/UploadRxScreen';
import MedicationsScreen from '../screens/MedicationsScreen';
import MealPlanScreen from '../screens/MealPlanScreen';
import AppointmentsScreen from '../screens/AppointmentsScreen';
import LiveEmotionScreen from '../screens/LiveEmotionScreen';
import ComplaintsScreen from '../screens/ComplaintsScreen';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="UploadRx" component={UploadRxScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Medications" component={MedicationsScreen} />
        <Stack.Screen name="MealPlan" component={MealPlanScreen} />
        <Stack.Screen name="Appointments" component={AppointmentsScreen} />
        <Stack.Screen name="LiveEmotion" component={LiveEmotionScreen} />
        <Stack.Screen name="Complaints" component={ComplaintsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
