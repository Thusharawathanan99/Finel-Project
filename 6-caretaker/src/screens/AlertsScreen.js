import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch } from '../apiHelper';
import { auth } from '../firebase/config';
import { useScreenRefresh } from '../useScreenRefresh';
const priority = severity => severity==='critical'?{label:'Critical',color:'#DC2626'}:severity==='high'||severity==='warning'?{label:'High',color:'#EA580C'}:severity==='medium'?{label:'Medium',color:'#A16207'}:{label:'Low',color:'#2563EB'};
export default function AlertsScreen({ navigation }) {
  const [wellness,setWellness]=useState([]),[emergencies,setEmergencies]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(null);
  const epoch=useRef(0),lock=useRef(false);
  const load=useCallback(async()=>{
    const run=++epoch.current,uid=auth.currentUser?.uid;if(!uid)return;
    try {const responses=await Promise.all([apiFetch('/emotions/wellness-alerts/'+encodeURIComponent(uid)),apiFetch('/sos-alerts')]);
      const data=await Promise.all(responses.map(response=>response.json()));
      if(responses.some(response=>!response.ok)||data.some(rows=>!Array.isArray(rows)))throw Error('Your assigned care alerts could not be loaded.');
      if(run===epoch.current&&auth.currentUser?.uid===uid){setWellness(data[0].filter(row=>!row.acknowledged));setEmergencies(data[1].filter(row=>!row.is_resolved));setError('');}
    }catch(e){if(run===epoch.current)setError(e.message);}finally{if(run===epoch.current)setLoading(false);}
  },[]);
  useScreenRefresh(navigation,load);
  React.useEffect(()=>{const timer=setInterval(()=>{if(navigation.isFocused())void load();},10000);return()=>{epoch.current++;clearInterval(timer);};},[navigation,load]);
  const resolve=async row=>{
    if(lock.current)return;lock.current=true;setBusy(row.id);
    try {const response=await apiFetch('/sos-alerts/'+row.id+'/resolve',{method:'PUT'});if(!response.ok)throw Error('The resolution could not be saved.');await load();}
    catch(e){setError(e.message);}finally{lock.current=false;setBusy(null);}
  };
  return <SafeAreaView style={{flex:1,backgroundColor:'#F6F5FF'}}><ScrollView contentContainerStyle={{padding:22}}>
    <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}>
      <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Dashboard')} style={{marginRight:12,padding:6}}>
        <MaterialCommunityIcons name="arrow-left" size={24} color="#171459" />
      </TouchableOpacity>
      <Text style={{fontSize:26,fontWeight:'800',color:'#171459'}}>Care Alerts</Text>
    </View>
    <Text style={{marginVertical:12,color:'#64748B'}}>Alerts for residents assigned to your care. Verify the resident's needs directly.</Text>
    {error?<Text accessibilityRole="alert" style={{color:'#991B1B'}}>{error}</Text>:null}<TouchableOpacity onPress={load}><Text style={{paddingVertical:12,color:'#6D38FF'}}>Refresh alerts</Text></TouchableOpacity>
    {loading?<ActivityIndicator/>:!error&&!wellness.length&&!emergencies.length?<Text>No active alerts.</Text>:null}
    {emergencies.map(row=><View key={'sos'+row.id} style={{backgroundColor:'white',borderWidth:1,borderColor:'#FCA5A5',borderRadius:14,padding:16,marginBottom:14}}>
      <Text style={{fontSize:18,fontWeight:'700',color:'#DC2626'}}>Emergency · {row.resident_name}</Text><Text style={{marginVertical:8}}>{row.message}</Text>
      <Text>Sender: {row.caretaker_name||row.requested_by_name||'Resident or care team'}</Text><Text>Location: {row.location||'See resident room record'}</Text><Text>{new Date(row.created_at).toLocaleString()}</Text>
      <TouchableOpacity disabled={busy!=null} onPress={()=>Alert.alert('Resolve emergency?','Confirm that the resident has been checked and help arranged.',[{text:'Keep open',style:'cancel'},{text:'Resolve',onPress:()=>void resolve(row)}])}><Text style={{paddingVertical:14,color:'#6D38FF'}}>{busy===row.id?'Saving…':'Resident checked — resolve'}</Text></TouchableOpacity>
    </View>)}
    {wellness.map(row=><TouchableOpacity key={'wellness'+row.id} onPress={()=>navigation.navigate('WellnessAlert',{alert:row})} style={{backgroundColor:'white',borderLeftWidth:4,borderLeftColor:priority(row.severity).color,borderRadius:14,padding:16,marginBottom:14}}>
      <Text style={{color:priority(row.severity).color,fontWeight:'700'}}>{priority(row.severity).label} · {row.resident_name}</Text><Text style={{marginVertical:8}}>{row.note||row.message||'A wellness observation needs review.'}</Text><Text>{new Date(row.created_at).toLocaleString()}</Text><Text style={{marginTop:12,color:'#6D38FF'}}>Review and acknowledge</Text>
    </TouchableOpacity>)}
  </ScrollView></SafeAreaView>;
}

