/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ENABLE_AI?: string;
  readonly VITE_ENABLE_CLOUD_NLP: string;
  readonly VITE_ENABLE_GEMINI_VERIFICATION: string;
  readonly VITE_ENABLE_MEAL_SUGGESTIONS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
