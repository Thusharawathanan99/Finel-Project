import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../apiHelper';
import { colomboDay, doseCountdown } from '../careSummary';
export default function NextDoseCountdown({ residentId }) {
  const [rows,setRows]=useState([]),[now,setNow]=useState(Date.now()),[error,setError]=useState('');const epoch=useRef(0);
  const load=async()=>{
    const run=++epoch.current;if(!residentId)return;
    try{const day=colomboDay(),days=[0,1,2].map(offset=>new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10));
      const groups=await Promise.all(days.map(async value=>{const response=await apiFetch('/residents/'+encodeURIComponent(residentId)+'/medication-reminders?day='+value),data=await response.json();if(!response.ok||!Array.isArray(data))throw Error('Next dose time could not be loaded.');return data;}));
      if(run===epoch.current){setRows([...new Map(groups.flat().map(row=>[String(row.reminder_id),row])).values()]);setError('');}
    }catch(e){if(run===epoch.current)setError(e.message);}
  };
  useEffect(()=>{void load();const refresh=setInterval(load,60000),clock=setInterval(()=>setNow(Date.now()),1000);return()=>{epoch.current++;clearInterval(refresh);clearInterval(clock);};},[residentId]);
  const countdown=doseCountdown(rows,now);
  return <View style={{padding:16,borderRadius:16,backgroundColor:'#EEE9FF',marginBottom:16}}><Text style={{fontWeight:'700',fontSize:17}}>Next scheduled dose</Text>{error?<TouchableOpacity onPress={load}><Text style={{color:'#991B1B',paddingTop:8}}>{error} Tap to retry.</Text></TouchableOpacity>:<><Text style={{fontSize:22,color:'#6D38FF',marginTop:8}}>{countdown.text}</Text>{countdown.next?<Text style={{marginTop:6}}>{countdown.next.drug_name} · {new Date(countdown.next.presentation_at).toLocaleString()}</Text>:null}</>}</View>;
}

