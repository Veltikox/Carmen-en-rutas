// Browser tile requests use the provider's normal cache and Referer behavior.
// For higher production traffic, replace this provider with a suitable hosted plan.
export const MAP_CONFIG={
  tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  center:[18.644,-91.829],
  zoom:14,
  minZoom:3,
  maxZoom:19
};
