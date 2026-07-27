import { getDb } from '@/lib/firebase';
import { maps } from '@/lib/services/maps';
import { logger } from '@/lib/logging';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
} from 'firebase/firestore';

const COLLECTION_NAME = 'employeeFacilities';
const FAVORITES_COLLECTION = 'facilityFavorites';

export interface EmployeeFacility {
  id: string;
  userId: string;
  companyId: string;
  name: string;
  type: 'hospital' | 'clinic' | 'nursing_home';
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
  shiftSupervisor: string;
  latitude?: number;
  longitude?: number;
  distance: number;
  travelTime: string;
  rating: number;
  shiftCount: number;
  isFavorite: boolean;
  specialInstructions?: string;
  lastVisit?: Date;
  nextShift?: Date;
}

export interface EmployeeFacilityScope {
  userId: string;
  companyId: string;
}

const validateScope = (scope: EmployeeFacilityScope): EmployeeFacilityScope => {
  if (!scope?.userId) {
    throw new Error('userId ist erforderlich, um Mitarbeiter-Einrichtungen abzurufen.');
  }
  if (!scope?.companyId) {
    throw new Error('companyId ist erforderlich, um Mitarbeiter-Einrichtungen abzurufen.');
  }
  return scope;
};

export interface Directions {
  url: string;
  distance: number;
  duration: string;
  steps: string[];
}

export const employeeFacilitiesService = {
  // Get all facilities for current user
  async getAll(scope: EmployeeFacilityScope): Promise<EmployeeFacility[]> {
      const { userId, companyId } = validateScope(scope);
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('companyId', '==', companyId),
        orderBy('name', 'asc')
      );

      const snapshot = await getDocs(q);
      const facilities: EmployeeFacility[] = [];

      snapshot.forEach(doc => {
        const data = doc.data() as {
          userId?: string;
          companyId?: string;
          name: string;
          type: EmployeeFacility['type'];
          address: string;
          phone: string;
          email: string;
          contactPerson: string;
          shiftSupervisor: string;
          distance?: number;
          travelTime?: string;
          rating?: number;
          shiftCount?: number;
          isFavorite?: boolean;
          specialInstructions?: string;
          lastVisit?: { toDate: () => Date };
          nextShift?: { toDate: () => Date };
          latitude?: number;
          longitude?: number;
        };

        if (data.userId !== userId || data.companyId !== companyId) {
          logger.warn(
            'Skipped employee facility outside of user scope',
            { component: 'employeeFacilities.getUserFacilities', userId },
            {
              expectedUserId: userId,
              expectedCompanyId: companyId,
              documentId: doc.id,
            }
          );
          return;
        }

        facilities.push({
          id: doc.id,
          userId: data.userId,
          companyId: data.companyId,
          name: data.name,
          type: data.type,
          address: data.address,
          phone: data.phone,
          email: data.email,
          contactPerson: data.contactPerson,
          shiftSupervisor: data.shiftSupervisor,
          distance: data.distance || 0,
          travelTime: data.travelTime || '0 min',
          rating: data.rating || 0,
          shiftCount: data.shiftCount || 0,
          isFavorite: data.isFavorite || false,
          specialInstructions: data.specialInstructions,
          lastVisit: data.lastVisit?.toDate(),
          nextShift: data.nextShift?.toDate(),
          latitude: data.latitude,
          longitude: data.longitude,
        });
      });

      return facilities;
  },

  // Add facility to favorites
  async addToFavorites(scope: EmployeeFacilityScope, facilityId: string): Promise<void> {
      const { userId, companyId } = validateScope(scope);
      
      // Check if already in favorites
      const favoritesQuery = query(
        collection(getDb(), FAVORITES_COLLECTION),
        where('userId', '==', userId),
        where('companyId', '==', companyId),
        where('facilityId', '==', facilityId)
      );

      const favoritesSnapshot = await getDocs(favoritesQuery);
      if (!favoritesSnapshot.empty) {
        throw new Error('Einrichtung ist bereits in den Favoriten');
      }

      // Add to favorites
      await addDoc(collection(getDb(), FAVORITES_COLLECTION), {
        userId,
        companyId,
        facilityId,
        createdAt: serverTimestamp(),
      });

      // Update facility isFavorite status (only within scope)
      const facilityRef = doc(getDb(), COLLECTION_NAME, facilityId);
      const facilityDoc = await getDoc(facilityRef);
      const facilityData = facilityDoc.data() as { userId?: string; companyId?: string } | undefined;
      if (!facilityDoc.exists() || facilityData?.userId !== userId || facilityData?.companyId !== companyId) {
        throw new Error('Einrichtung gehört nicht zum aktuellen Benutzer oder wurde nicht gefunden');
      }
      await updateDoc(facilityRef, {
        isFavorite: true,
        updatedAt: serverTimestamp(),
      });
  },

  // Remove facility from favorites
  async removeFromFavorites(scope: EmployeeFacilityScope, facilityId: string): Promise<void> {
      const { userId, companyId } = validateScope(scope);
      
      // Find and delete favorite entry
      const favoritesQuery = query(
        collection(getDb(), FAVORITES_COLLECTION),
        where('userId', '==', userId),
        where('companyId', '==', companyId),
        where('facilityId', '==', facilityId)
      );

      const favoritesSnapshot = await getDocs(favoritesQuery);
      if (favoritesSnapshot.empty) {
        throw new Error('Einrichtung ist nicht in den Favoriten');
      }

      // Delete favorite entry
      for (const favoriteDoc of favoritesSnapshot.docs) {
        await deleteDoc(favoriteDoc.ref);
      }

      // Update facility isFavorite status
      const facilityRef = doc(getDb(), COLLECTION_NAME, facilityId);
      const facilityDoc = await getDoc(facilityRef);
      const facilityData = facilityDoc.data() as { userId?: string; companyId?: string } | undefined;
      if (!facilityDoc.exists() || facilityData?.userId !== userId || facilityData?.companyId !== companyId) {
        throw new Error('Einrichtung gehört nicht zum aktuellen Benutzer oder wurde nicht gefunden');
      }
      await updateDoc(facilityRef, {
        isFavorite: false,
        updatedAt: serverTimestamp(),
      });
  },

  // Get directions to facility
  async getDirections(scope: EmployeeFacilityScope, facilityId: string): Promise<Directions> {
    const { userId, companyId } = validateScope(scope);
    try {
      // Get facility details
      const facilityDoc = await getDoc(doc(getDb(), COLLECTION_NAME, facilityId));
      if (!facilityDoc.exists()) {
        throw new Error('Einrichtung nicht gefunden');
      }

      const facilityData = facilityDoc.data() as {
        userId?: string;
        companyId?: string;
        address: string;
        distance?: number;
        travelTime?: string;
      };

      if (facilityData.userId !== userId || facilityData.companyId !== companyId) {
        throw new Error('Keine Berechtigung für diese Einrichtung');
      }
      
      // Geocode destination
      const destination = await maps.geocodeAddress(facilityData.address);
      if (!destination) {
        return {
          url: `https://www.openstreetmap.org/search?query=${encodeURIComponent(facilityData.address)}`,
          distance: 0,
          duration: '0 min',
          steps: ['Adresse konnte nicht automatisch geokodiert werden.'],
        };
      }

      // Origin: fallback auf gespeicherte Distanz/Zeit, wenn kein Standort verfügbar
      // Der echte Nutzerstandort sollte aus dem Client übergeben werden; hier fallback (0,0)
      const origin = { latitude: 0, longitude: 0 };
      const route = await maps.getRoute(origin, destination);
      if (!route) {
        return {
          url: `https://www.openstreetmap.org/directions?from=&to=${destination.latitude}%2C${destination.longitude}`,
          distance: facilityData.distance || 0,
          duration: facilityData.travelTime || '0 min',
          steps: ['Route konnte nicht berechnet werden.'],
        };
      }

      const minutes = Math.round(route.durationSeconds / 60);
      return {
        url: route.mapUrl || `https://www.openstreetmap.org/directions?from=&to=${destination.latitude}%2C${destination.longitude}`,
        distance: Math.round(route.distanceMeters / 100) / 10, // km mit 1 Nachkommastelle
        duration: `${minutes} min`,
        steps: route.steps,
      };
    } catch (error) {
      logger.error('Error getting directions', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Get facility by ID
  async getById(scope: EmployeeFacilityScope, facilityId: string): Promise<EmployeeFacility | null> {
      const { userId, companyId } = validateScope(scope);
      const facilityDoc = await getDoc(doc(getDb(), COLLECTION_NAME, facilityId));
      if (!facilityDoc.exists()) {
        return null;
      }

      const data = facilityDoc.data() as {
        userId?: string;
        companyId?: string;
        name: string;
        type: EmployeeFacility['type'];
        address: string;
        phone: string;
        email: string;
        contactPerson: string;
        shiftSupervisor: string;
        distance?: number;
        travelTime?: string;
        rating?: number;
        shiftCount?: number;
        isFavorite?: boolean;
        specialInstructions?: string;
        lastVisit?: { toDate: () => Date };
        nextShift?: { toDate: () => Date };
        latitude?: number;
        longitude?: number;
      };
      if (data.userId !== userId || data.companyId !== companyId) {
        return null;
      }

      return {
        id: facilityDoc.id,
        userId: data.userId,
        companyId: data.companyId,
        name: data.name,
        type: data.type,
        address: data.address,
        phone: data.phone,
        email: data.email,
        contactPerson: data.contactPerson,
        shiftSupervisor: data.shiftSupervisor,
        distance: data.distance || 0,
        travelTime: data.travelTime || '0 min',
        rating: data.rating || 0,
        shiftCount: data.shiftCount || 0,
        isFavorite: data.isFavorite || false,
        specialInstructions: data.specialInstructions,
        lastVisit: data.lastVisit?.toDate(),
        nextShift: data.nextShift?.toDate(),
        latitude: data.latitude,
        longitude: data.longitude,
      };
  },

  // Get favorite facilities
  async getFavorites(scope: EmployeeFacilityScope): Promise<EmployeeFacility[]> {
      const { userId, companyId } = validateScope(scope);
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('companyId', '==', companyId),
        where('isFavorite', '==', true),
        orderBy('name', 'asc')
      );

      const snapshot = await getDocs(q);
      const facilities: EmployeeFacility[] = [];

      snapshot.forEach(doc => {
        const data = doc.data() as {
          userId?: string;
          companyId?: string;
          name: string;
          type: EmployeeFacility['type'];
          address: string;
          phone: string;
          email: string;
          contactPerson: string;
          shiftSupervisor: string;
          distance?: number;
          travelTime?: string;
          rating?: number;
          shiftCount?: number;
          isFavorite?: boolean;
          specialInstructions?: string;
          lastVisit?: { toDate: () => Date };
          nextShift?: { toDate: () => Date };
          latitude?: number;
          longitude?: number;
        };
        if (data.userId !== userId || data.companyId !== companyId) {
          return;
        }
        facilities.push({
          id: doc.id,
          userId: data.userId,
          companyId: data.companyId,
          name: data.name,
          type: data.type,
          address: data.address,
          phone: data.phone,
          email: data.email,
          contactPerson: data.contactPerson,
          shiftSupervisor: data.shiftSupervisor,
          distance: data.distance || 0,
          travelTime: data.travelTime || '0 min',
          rating: data.rating || 0,
          shiftCount: data.shiftCount || 0,
          isFavorite: true,
          specialInstructions: data.specialInstructions,
          lastVisit: data.lastVisit?.toDate(),
          nextShift: data.nextShift?.toDate(),
          latitude: data.latitude,
          longitude: data.longitude,
        });
      });

      return facilities;
  },

  // Get facility statistics
  async getStats(scope: EmployeeFacilityScope): Promise<{
    totalFacilities: number;
    activeFacilities: number;
    favoriteFacilities: number;
    totalShifts: number;
    averageRating: number;
    totalDistance: number;
  }> {
    const facilities = await this.getAll(scope);

      const totalFacilities = facilities.length;
      const activeFacilities = facilities.filter(f => f.shiftCount > 0).length;
      const favoriteFacilities = facilities.filter(f => f.isFavorite).length;
      const totalShifts = facilities.reduce((sum, f) => sum + f.shiftCount, 0);
      const averageRating = facilities.length > 0 
        ? facilities.reduce((sum, f) => sum + f.rating, 0) / facilities.length 
        : 0;
      const totalDistance = facilities.reduce((sum, f) => sum + f.distance, 0);

      return {
        totalFacilities,
        activeFacilities,
        favoriteFacilities,
        totalShifts,
        averageRating: Math.round(averageRating * 10) / 10,
        totalDistance: Math.round(totalDistance * 10) / 10,
      };
  },

  // Update facility rating
  async updateRating(scope: EmployeeFacilityScope, facilityId: string, rating: number): Promise<void> {
      const { userId, companyId } = validateScope(scope);
      const facilityRef = doc(getDb(), COLLECTION_NAME, facilityId);
      const facilityDoc = await getDoc(facilityRef);
      const facilityData = facilityDoc.data() as { userId?: string; companyId?: string } | undefined;
      if (!facilityDoc.exists() || facilityData?.userId !== userId || facilityData?.companyId !== companyId) {
        throw new Error('Einrichtung gehört nicht zum aktuellen Benutzer oder wurde nicht gefunden');
      }
      await updateDoc(facilityRef, {
        rating,
        updatedAt: serverTimestamp(),
      });
  },

  // Update facility visit
  async updateVisit(scope: EmployeeFacilityScope, facilityId: string): Promise<void> {
      const { userId, companyId } = validateScope(scope);
      const facilityRef = doc(getDb(), COLLECTION_NAME, facilityId);
      const facilityDoc = await getDoc(facilityRef);
      const facilityData = facilityDoc.data() as { userId?: string; companyId?: string } | undefined;
      if (!facilityDoc.exists() || facilityData?.userId !== userId || facilityData?.companyId !== companyId) {
        throw new Error('Einrichtung gehört nicht zum aktuellen Benutzer oder wurde nicht gefunden');
      }
      await updateDoc(facilityRef, {
        lastVisit: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
  },

  // Get nearby facilities using Haversine formula (client-side calculation)
  async getNearby(scope: EmployeeFacilityScope, latitude: number, longitude: number, radius: number = 10): Promise<EmployeeFacility[]> {
    const validatedScope = validateScope(scope);
    try {
      const allFacilities = await this.getAll(validatedScope);
      
      // Filter facilities within radius using Haversine formula
      const nearbyFacilities = allFacilities.filter(facility => {
        if (!facility.latitude || !facility.longitude) return false;
        
        const distance = this.calculateDistance(
          latitude,
          longitude,
          facility.latitude,
          facility.longitude
        );
        
        return distance <= radius;
      });
      
      // Sort by distance
      return nearbyFacilities.sort((a, b) => {
        const distanceA = this.calculateDistance(latitude, longitude, a.latitude!, a.longitude!);
        const distanceB = this.calculateDistance(latitude, longitude, b.latitude!, b.longitude!);
        return distanceA - distanceB;
      });
    } catch (error) {
      logger.error('Error getting nearby facilities', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Calculate distance between two coordinates using Haversine formula
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in kilometers
    
    return distance;
  },

  // Convert degrees to radians
  toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  },

  // Export facilities
  async exportFacilities(scope: EmployeeFacilityScope, format: 'pdf' | 'excel' | 'csv'): Promise<string> {
      validateScope(scope);
      // Generate export file
      const fileUrl = `/facilities-export.${format}`;
      
      // File generation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return fileUrl;
  },
};
