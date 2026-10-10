import React, { useEffect, useState } from 'react';
import { AppState, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch } from '../apiHelper';
import { auth } from '../firebase/config';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import PatientListScreen from '../screens/PatientListScreen';
import PatientProfileScreen from '../screens/PatientProfileScreen';
import UploadRxScreen from '../screens/UploadRxScreen';
import LeaveRequestScreen from '../screens/LeaveRequestScreen';
import WellnessAlertScreen from '../screens/WellnessAlertScreen';
import AlertsScreen from '../screens/AlertsScreen';

const Stack = createNativeStackNavigator();
const tabs = [['Dashboard','Home','home-outline'],['PatientList','Residents','account-group-outline'],['LeaveRequest','Leave','calendar-export'],['Alerts','Alerts','bell-outline']];

const AppNavigator = ({ initialRouteName = 'Login' }) => {
  const navigation = useNavigationContainerRef();
  const [currentRoute,setCurrentRoute] = useState(initialRouteName),[alertCount,setAlertCount] = useState(0);
  useEffect(()=>{
    let active=true,busy=false;
    const refresh=async()=>{const uid=auth.currentUser?.uid;if(!uid||busy||AppState.currentState!=='active')return;busy=true;
      try{const responses=await Promise.all([apiFetch('/emotions/wellness-alerts/'+encodeURIComponent(uid)),apiFetch('/sos-alerts')]);const rows=await Promise.all(responses.map(response=>response.json()));
        if(active&&auth.currentUser?.uid===uid&&responses.every(response=>response.ok)&&rows.every(Array.isArray))setAlertCount(rows[0].filter(row=>!row.acknowledged).length+rows[1].filter(row=>!row.is_resolved).length);
      }catch{}finally{busy=false;}
    };
    if(currentRoute==='Login'){setAlertCount(0);return;}
    void refresh();const timer=setInterval(refresh,10000);return()=>{active=false;clearInterval(timer);};
  },[currentRoute]);
  return (
    <NavigationContainer ref={navigation} onReady={()=>setCurrentRoute(navigation.getCurrentRoute()?.name)} onStateChange={()=>setCurrentRoute(navigation.getCurrentRoute()?.name)}>
      <View style={{flex:1}}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#F2F6F3' } }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="PatientList" component={PatientListScreen} />
        <Stack.Screen name="PatientProfile" component={PatientProfileScreen} />
        <Stack.Screen name="UploadRx" component={UploadRxScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="LeaveRequest" component={LeaveRequestScreen} />
        <Stack.Screen name="WellnessAlert" component={WellnessAlertScreen} />
        <Stack.Screen name="Alerts" component={AlertsScreen} />
      </Stack.Navigator>
      {tabs.some(([route])=>route===currentRoute)?<SafeAreaView edges={['bottom']} style={{backgroundColor:'white',borderTopWidth:1,borderColor:'#E2E8F0'}}><View style={{flexDirection:'row'}}>{tabs.map(([route,label,icon])=><TouchableOpacity accessibilityRole="tab" accessibilityState={{selected:currentRoute===route}} accessibilityLabel={label+(route==='Alerts'&&alertCount?' · '+alertCount+' active alerts':'')} key={route} onPress={()=>{if(currentRoute!==route)navigation.navigate(route);}} style={{flex:1,alignItems:'center',paddingVertical:10,minHeight:55}}><View><MaterialCommunityIcons name={icon} size={23} color={currentRoute===route?'#6D38FF':'#64748B'}/>{route==='Alerts'&&alertCount>0?<View style={{position:'absolute',right:-16,top:-4,borderRadius:10,backgroundColor:'#DC2626',paddingHorizontal:5}}><Text style={{fontSize:10,color:'white'}}>{alertCount>99?'99+':alertCount}</Text></View>:null}</View><Text style={{fontSize:11,color:currentRoute===route?'#6D38FF':'#64748B'}}>{label}</Text></TouchableOpacity>)}</View></SafeAreaView>:null}
      </View>
    </NavigationContainer>
  );
};

export default AppNavigator;
