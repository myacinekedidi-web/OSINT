/** A single OSINT resource (a leaf in the tree), as provided by the data source. */
export type Resource = {
    id: string;
    name: string;
    url: string;
    description?: string;
    tags?: string[];
    /** Short note on the use case this resource is best suited for. */
    bestFor?: string;
    /** Legal, ethical or reliability caveats shown to the user. */
    caution?: string;
};

/** A group of related resources (a branch in the tree). */
export type Category = {
    id: string;
    name: string;
    description?: string;
    resources: Resource[];
};

/** Shape of the raw data passed into the component (e.g. from a JSON file). */
export type OsintData = {
    title?: string;
    version?: number;
    description?: string;
    categories: Category[];
};

/**
 * Unified node type used by d3-hierarchy. Root, categories and resources all
 * share this shape so one tree can represent every level; `kind` tells them apart.
 * Resource-only fields (url, tags, bestFor, caution) are undefined on other kinds.
 */
export type TreeNode = {
    id: string;
    name: string;
    kind: "root" | "category" | "resource";
    url?: string;
    description?: string;
    tags?: string[];
    bestFor?: string;
    caution?: string;
    /** Number of resources in a category (displayed as a badge on category nodes). */
    count?: number;
    children?: TreeNode[];
};
