import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch, getResidentId } from '../apiHelper';
import { useScreenRefresh } from '../useScreenRefresh';
const fields = [['address','Street address'],['city','City'],['state','State'],['zipCode','ZIP code'],['emergencyContactName','Emergency contact name'],['emergencyContactPhone','Emergency contact phone'],['emergencyContactRelation','Emergency contact relation']];
const columns = { zipCode:'zip_code', emergencyContactName:'emergency_contact_name', emergencyContactPhone:'emergency_contact_phone', emergencyContactRelation:'emergency_contact_relation' };
export default function ProfileScreen({ navigation }) {
  const [record,setRecord]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const locked=useRef(false),dirty=useRef(false),generation=useRef(0);
  const load=useCallback(async()=>{
    const run=++generation.current;
    try { const id=await getResidentId(),response=await apiFetch('/residents/'+encodeURIComponent(id)),data=await response.json();
      if(!response.ok)throw Error(data.error||'Your profile could not be loaded.');
      if(run===generation.current){setRecord(data);setError('');}
    } catch(e){if(run===generation.current)setError(e.message);}
  },[]);
  useScreenRefresh(navigation,load);
  React.useEffect(()=>()=>{generation.current++;},[]);
  React.useEffect(()=>navigation.addListener('beforeRemove',event=>{
    if(!dirty.current||locked.current)return;
    event.preventDefault();
    Alert.alert('Discard edits?','Your address and emergency contact changes have not been saved.',[{text:'Keep editing',style:'cancel'},{text:'Discard',style:'destructive',onPress:()=>{dirty.current=false;navigation.dispatch(event.data.action);}}]);
  }),[navigation]);
  const edit=()=>{setDraft(Object.fromEntries(fields.map(([key])=>[key,String(record[columns[key]||key]??'')])));dirty.current=false;};
  const save=async()=>{
    if(locked.current||!draft)return;locked.current=true;setSaving(true);setError('');
    try {const response=await apiFetch('/residents/'+encodeURIComponent(record.resident_id),{method:'PUT',body:JSON.stringify(Object.fromEntries(fields.map(([key])=>[key,draft[key].trim()])))});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Changes could not be saved.');
      dirty.current=false;setDraft(null);await load();
    }catch(e){setError(e.message);}finally{locked.current=false;setSaving(false);}
  };
  return <SafeAreaView style={{flex:1,backgroundColor:'#F6F5FF'}}><ScrollView contentContainerStyle={{padding:22}}>
    <Text style={{fontSize:26,fontWeight:'800',color:'#171459'}}>My Profile</Text>
    {error?<Text accessibilityRole="alert" style={{color:'#991B1B',marginVertical:12}}>{error}</Text>:null}
    {!record?<TouchableOpacity onPress={load}><ActivityIndicator/><Text>Refresh profile</Text></TouchableOpacity>:<>
      <View style={{backgroundColor:'white',padding:18,borderRadius:18,marginVertical:16}}>
        {[['Name',record.name],['Age',record.age],['Resident ID',record.resident_id],['Date of birth',record.date_of_birth],['Room',record.room_number],['Floor',record.floor_number]].map(([label,value])=><Text key={label} style={{fontSize:16,marginVertical:6}}>{label}: {value??'Not recorded'}</Text>)}
      </View>
      {fields.map(([key,label])=><View key={key} style={{marginBottom:14}}><Text style={{fontWeight:'700',marginBottom:6}}>{label}</Text>{draft?<TextInput accessibilityLabel={label} editable={!saving} maxLength={key==='address'?1000:255} keyboardType={key==='emergencyContactPhone'?'phone-pad':'default'} value={draft[key]} onChangeText={value=>{dirty.current=true;setDraft(current=>({...current,[key]:value}));}} style={{minHeight:48,borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding:12,backgroundColor:'white'}}/>:<Text style={{fontSize:16}}>{record[columns[key]||key]||'Not recorded'}</Text>}</View>)}
      <TouchableOpacity disabled={saving} onPress={draft?save:edit} style={{padding:16,backgroundColor:'#6D38FF',borderRadius:12,alignItems:'center'}}><Text style={{color:'white',fontWeight:'700'}}>{saving?'Saving…':draft?'Save Info':'Edit Info'}</Text></TouchableOpacity>
      {draft?<TouchableOpacity disabled={saving} onPress={()=>{dirty.current=false;setDraft(null);setError('');}}><Text style={{padding:16,textAlign:'center'}}>Cancel edits</Text></TouchableOpacity>:null}
    </>}
  </ScrollView></SafeAreaView>;
}

