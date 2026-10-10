import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import DashboardScreen from '../screens/DashboardScreen';
import UploadRxScreen from '../screens/UploadRxScreen';
import MedicationsScreen from '../screens/MedicationsScreen';
import MealPlanScreen from '../screens/MealPlanScreen';
import AppointmentsScreen from '../screens/AppointmentsScreen';
import LiveEmotionScreen from '../screens/LiveEmotionScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const tabs = [['Dashboard','Home','home-outline'],['Medications','Meds','pill'],['Appointments','Appts','calendar-outline'],['LiveEmotion','Feel','emoticon-outline'],['MealPlan','Meals','silverware-fork-knife'],['Profile','Profile','account-outline']];

const AppNavigator = ({ initialRouteName = 'Login' }) => {
  const navigation = useNavigationContainerRef();
  const [currentRoute,setCurrentRoute] = useState(initialRouteName);
  return (
    <NavigationContainer ref={navigation} onReady={()=>setCurrentRoute(navigation.getCurrentRoute()?.name)} onStateChange={()=>setCurrentRoute(navigation.getCurrentRoute()?.name)}>
      <View style={{flex:1}}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#F2F6F3' } }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="UploadRx" component={UploadRxScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Medications" component={MedicationsScreen} />
        <Stack.Screen name="MealPlan" component={MealPlanScreen} />
        <Stack.Screen name="Appointments" component={AppointmentsScreen} />
        <Stack.Screen name="LiveEmotion" component={LiveEmotionScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
      {tabs.some(([route])=>route===currentRoute)?<SafeAreaView edges={['bottom']} style={{backgroundColor:'white',borderTopWidth:1,borderColor:'#E2E8F0'}}><View style={{flexDirection:'row'}}>{tabs.map(([route,label,icon])=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:currentRoute===route}} accessibilityLabel={label} key={route} onPress={()=>{if(currentRoute!==route)navigation.navigate(route);}} style={{flex:1,alignItems:'center',paddingVertical:10,minHeight:55}}><MaterialCommunityIcons name={icon} size={23} color={currentRoute===route?'#6D38FF':'#64748B'}/><Text style={{fontSize:11,color:currentRoute===route?'#6D38FF':'#64748B'}}>{label}</Text></TouchableOpacity>)}</View></SafeAreaView>:null}
      </View>
    </NavigationContainer>
  );
};

export default AppNavigator;
