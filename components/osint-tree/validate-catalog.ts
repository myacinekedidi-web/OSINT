import { isSafeUrl } from "./url";

/**
 * Validates the raw catalog (data/osint-resources.json) and returns a list of
 * human-readable problems; an empty list means the catalog is valid.
 *
 * It takes `unknown` on purpose: the JSON is untrusted input, so the TypeScript
 * types alone prove nothing. The rules go further than the types do: they also
 * require the fields the README promises (description, tags, bestFor, caution)
 * and catch duplicates and typos.
 */

const ROOT_KEYS = ["title", "version", "description", "categories"];
const CATEGORY_KEYS = ["id", "name", "description", "resources"];
const RESOURCE_KEYS = ["id", "name", "url", "description", "tags", "bestFor", "caution"];

/** kebab-case: lowercase letters and digits separated by single hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Same resource, different spelling: ignore a trailing slash and the #fragment. */
function normalizeUrl(url: string): string {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

function checkUnknownKeys(obj: JsonObject, allowed: string[], where: string, errors: string[]) {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
            errors.push(`${where}: unknown field "${key}" (typo? allowed: ${allowed.join(", ")})`);
        }
    }
}

/** A required, non-empty, trimmed string. */
function checkText(obj: JsonObject, key: string, where: string, errors: string[]) {
    const value = obj[key];
    if (typeof value !== "string" || value.trim() === "") {
        errors.push(`${where}: "${key}" is required and must be a non-empty string`);
    } else if (value !== value.trim()) {
        errors.push(`${where}: "${key}" has leading or trailing whitespace`);
    }
}

function checkSlug(obj: JsonObject, where: string, seen: Set<string>, errors: string[]) {
    const id = obj.id;
    if (typeof id !== "string" || !SLUG.test(id)) {
        errors.push(`${where}: "id" must be kebab-case (lowercase letters, digits, hyphens), got ${JSON.stringify(id)}`);
        return;
    }
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
}

function checkResource(resource: unknown, where: string, ids: Set<string>, urls: Map<string, string>, errors: string[]) {
    if (!isObject(resource)) {
        errors.push(`${where}: must be an object`);
        return;
    }
    checkUnknownKeys(resource, RESOURCE_KEYS, where, errors);
    checkSlug(resource, where, ids, errors);
    checkText(resource, "name", where, errors);
    checkText(resource, "description", where, errors);
    checkText(resource, "bestFor", where, errors);
    checkText(resource, "caution", where, errors);

    const url = resource.url;
    if (typeof url !== "string" || url === "") {
        errors.push(`${where}: "url" is required`);
    } else if (/\s/.test(url)) {
        errors.push(`${where}: "url" must not contain whitespace`);
    } else if (!isSafeUrl(url)) {
        errors.push(`${where}: "url" must be a valid https URL, got ${JSON.stringify(url)}`);
    } else {
        const key = normalizeUrl(url);
        const first = urls.get(key);
        if (first) errors.push(`${where}: duplicate url (already used by ${first})`);
        else urls.set(key, where);
    }

    const tags = resource.tags;
    if (!Array.isArray(tags) || tags.length === 0) {
        errors.push(`${where}: "tags" is required and must be a non-empty array`);
    } else {
        const seen = new Set<string>();
        for (const tag of tags) {
            if (typeof tag !== "string" || !SLUG.test(tag)) {
                errors.push(`${where}: tag ${JSON.stringify(tag)} must be kebab-case`);
            } else if (seen.has(tag)) {
                errors.push(`${where}: duplicate tag "${tag}"`);
            }
            if (typeof tag === "string") seen.add(tag);
        }
    }
}

export function validateCatalog(data: unknown): string[] {
    const errors: string[] = [];

    if (!isObject(data)) return ["catalog: must be a JSON object"];
    checkUnknownKeys(data, ROOT_KEYS, "catalog", errors);

    if (data.title !== undefined && typeof data.title !== "string") {
        errors.push(`catalog: "title" must be a string`);
    }
    if (data.version !== undefined && !(Number.isInteger(data.version) && (data.version as number) > 0)) {
        errors.push(`catalog: "version" must be a positive integer`);
    }

    const categories = data.categories;
    if (!Array.isArray(categories) || categories.length === 0) {
        errors.push(`catalog: "categories" is required and must be a non-empty array`);
        return errors;
    }

    const categoryIds = new Set<string>();
    const resourceIds = new Set<string>();
    const urls = new Map<string, string>();

    categories.forEach((category: unknown, i) => {
        const label = isObject(category) && typeof category.id === "string" ? ` ("${category.id}")` : "";
        const where = `categories[${i}]${label}`;
        if (!isObject(category)) {
            errors.push(`${where}: must be an object`);
            return;
        }
        checkUnknownKeys(category, CATEGORY_KEYS, where, errors);
        checkSlug(category, where, categoryIds, errors);
        checkText(category, "name", where, errors);
        checkText(category, "description", where, errors);

        const resources = category.resources;
        if (!Array.isArray(resources) || resources.length === 0) {
            errors.push(`${where}: "resources" is required and must be a non-empty array`);
            return;
        }
        resources.forEach((resource: unknown, j) => {
            const rLabel = isObject(resource) && typeof resource.id === "string" ? ` ("${resource.id}")` : "";
            checkResource(resource, `${where}.resources[${j}]${rLabel}`, resourceIds, urls, errors);
        });
    });

    return errors;
}
