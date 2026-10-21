import type { OsintData, TreeNode } from "./osint-types";

/** Id of the single root node. */
export const ROOT_ID = "osint-root";

// Prefixes that keep category and resource ids from colliding (React keys, `expanded`, `favorites`...)
export const CATEGORY_ID_PREFIX = "cat:";
export const RESOURCE_ID_PREFIX = "res:";

/**
 * Converts the raw data (categories -> resources) into the TreeNode hierarchy
 * with a single root, so d3 can lay it out. Category and resource ids get their prefixes here.
 */
export function buildTree(data: OsintData): TreeNode {
    return {
        id: ROOT_ID,
        name: data.title || "OSINT Resources",
        kind: "root",
        children: (data.categories || []).map((category) => ({
            id: `${CATEGORY_ID_PREFIX}${category.id}`,
            name: category.name,
            kind: "category" as const,
            description: category.description,
            count: category.resources?.length || 0,
            children: (category.resources || []).map((resource) => ({
                id: `${RESOURCE_ID_PREFIX}${resource.id}`,
                name: resource.name,
                kind: "resource" as const,
                url: resource.url,
                description: resource.description,
                tags: resource.tags,
                bestFor: resource.bestFor,
                caution: resource.caution,
            })),
        })),
    };
}

/** A resource together with its path from the root, e.g. [root, category, resource]. */
export type ResourceEntry = { node: TreeNode; path: TreeNode[] };

/**
 * Lookup table: resource id -> the resource plus its path from the root.
 * Build it from the full tree (not the filtered one), so a resource is found
 * even while it is collapsed or filtered out.
 */
export function buildResourceIndex(root: TreeNode): Map<string, ResourceEntry> {
    const index = new Map<string, ResourceEntry>();

    const walk = (node: TreeNode, parents: TreeNode[]) => {
        const path = [...parents, node];
        if (node.kind === "resource") index.set(node.id, { node, path });
        node.children?.forEach((child) => walk(child, path));
    };

    walk(root, []);
    return index;
}
