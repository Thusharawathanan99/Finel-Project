import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import PatientListScreen from '../screens/PatientListScreen';
import PatientProfileScreen from '../screens/PatientProfileScreen';
import UploadRxScreen from '../screens/UploadRxScreen';
import LeaveRequestScreen from '../screens/LeaveRequestScreen';
import WellnessAlertScreen from '../screens/WellnessAlertScreen';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="PatientList" component={PatientListScreen} />
        <Stack.Screen name="PatientProfile" component={PatientProfileScreen} />
        <Stack.Screen name="UploadRx" component={UploadRxScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="LeaveRequest" component={LeaveRequestScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="WellnessAlert" component={WellnessAlertScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;

