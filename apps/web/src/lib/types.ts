export interface StaffMember {
  id: string;
  userId: string;
  displayName: string;
  color: string;
  isActive: boolean;
  isBookableOnline: boolean;
  services: { id: string; name: string }[];
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  isActive: boolean;
  services: number;
}

export interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: { id: string; name: string; color: string | null };
  durationMin: number;
  bufferAfterMin: number;
  price: string;
  currency: string;
  isActive: boolean;
  isOnlineBookable: boolean;
  staff: { id: string; displayName: string; color: string; isActive: boolean }[];
}

export interface ClientFull {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  birthDate: string | null;
  preferences: string | null;
  allergies: string | null;
  contraindications: string | null;
  internalNotes?: string | null;
  source: string | null;
  tags: string[];
  marketingOptIn: boolean;
  stats: { visits: number; noShows: number; totalSpent: string; firstVisitAt: string | null; lastVisitAt: string | null };
  createdAt: string;
  restricted: false;
}

export interface ClientRestricted {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  preferences: string | null;
  allergies: string | null;
  contraindications: string | null;
  restricted: true;
}

export type Client = ClientFull | ClientRestricted;

export const formatMoney = (value: string | number) =>
  `Bs ${Number(value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface PackageItem {
  serviceId: string;
  serviceName: string;
  durationMin: number;
  sequence: number;
  parallelGroup: number;
}

export interface ServicePackage {
  id: string;
  name: string;
  description: string | null;
  price: string;
  listPrice: string;
  totalMin: number;
  isActive: boolean;
  items: PackageItem[];
}

