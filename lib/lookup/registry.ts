import type { Provider } from "./provider";
import { internetDb } from "./providers/internetdb";

/** Every data source the lookup can use, in the order they appear in a report. */
export const PROVIDERS: readonly Provider[] = [internetDb];
