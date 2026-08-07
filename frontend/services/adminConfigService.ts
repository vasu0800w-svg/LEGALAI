import { db } from './firebaseService';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Admin keys ko Firestore se fetch karne ka function
export const getCloudAdminConfig = async (configType: 'api_keys' | 'email_keys') => {
  try {
    const docRef = doc(db, 'users_data', `admin_config_${configType}`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    }
  } catch (error) {
    console.error(`Error fetching ${configType} from Firestore:`, error);
  }
  return null;
};

// Admin keys ko Firestore par save karne ka function
export const saveCloudAdminConfig = async (configType: 'api_keys' | 'email_keys', data: any) => {
  try {
    const docRef = doc(db, 'users_data', `admin_config_${configType}`);
    await setDoc(docRef, { ...data, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch (error) {
    console.error(`Error saving ${configType} to Firestore:`, error);
    return false;
  }
};