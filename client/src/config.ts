export const WIDTH = 960;
export const HEIGHT = 600;

// Server configuration
export const SERVER_BASE_URL: string = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// Biome color scheme
export const BIOME_COLORS: { [key: number]: string } = {
  0: "#88aa55",   // Plains - Grassland
  1: "#679459",   // Woods - Temperate Deciduous Forest
  2: "#337755",   // Rainforest - Tropical Rain Forest
  3: "#2f6666",   // Wetlands - Marsh
  4: "#889977",   // Hills - Shrubland
  5: "#888888",   // Mountains - Bare
  6: "#44447a",   // Shallow Ocean - Ocean
  7: "#33335a",   // Deep Ocean - (darker)
  8: "#bbbbaa",   // Tundra Plains - Tundra
  9: "#99aa77",   // Tundra Woods - Taiga
  10: "#bbbbaa",  // Tundra Hills - Tundra
  11: "#ffffff",  // Tundra Mountains - Ice
  12: "#d2b98b",  // Desert Plains - Subtropical Desert
  13: "#c9d29b",  // Desert Hills - Temperate Desert
  14: "#555555"   // Desert Mountains - Scorched
};
