import type { Provider } from "./provider";
import { crtsh } from "./providers/crtsh";
import { dns } from "./providers/dns";
import { internetDb } from "./providers/internetdb";
import { rdap } from "./providers/rdap";

/** Every data source the lookup can use, in the order they appear in a report. */
export const PROVIDERS: readonly Provider[] = [rdap, dns, internetDb, crtsh];
