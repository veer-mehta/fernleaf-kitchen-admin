// The one JSON error shape every API failure uses. `fields` maps form field -> message.
export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}
