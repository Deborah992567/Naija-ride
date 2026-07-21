import type { GeoPoint } from "@/src/lib/walking";

export type CampusDestination = GeoPoint & {
  id: string;
  name: string;
  area: string;
  icon: "school" | "bed" | "book" | "fitness" | "medical";
};

// Curated destinations make campus navigation dependable without relying on
// incomplete third-party place data. Campuses can add their own landmarks here.
export const CAMPUS_DESTINATIONS: CampusDestination[] = [
  { id: "science", name: "Faculty of Science", area: "Academic area", icon: "school", latitude: 6.5181, longitude: 3.3974 },
  { id: "senate", name: "Senate Building", area: "Central campus", icon: "school", latitude: 6.5202, longitude: 3.399 },
  { id: "sports", name: "Sports Centre", area: "Sports complex", icon: "fitness", latitude: 6.5163, longitude: 3.4021 },
  { id: "moremi", name: "Moremi Hall", area: "Student residence", icon: "bed", latitude: 6.5151, longitude: 3.399 },
  { id: "library", name: "Main Library", area: "Central campus", icon: "book", latitude: 6.5191, longitude: 3.3982 },
  { id: "health", name: "University Health Centre", area: "Campus services", icon: "medical", latitude: 6.5173, longitude: 3.3956 },
];
