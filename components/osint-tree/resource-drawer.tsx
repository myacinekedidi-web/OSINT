import type { ComponentProps } from "react";
import { Copy, ExternalLink, Star } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import type { TreeNode } from "./osint-types";
import { isSafeUrl } from "./url";

// Drawer snap points: first stop at 31rem, second at full height (1 = 100%)
const SNAP_POINTS = ["31rem", 1];

// Same type as the drawer popup's own `finalFocus` prop (what gets focus when the drawer closes)
type FinalFocus = ComponentProps<typeof DrawerContent>["finalFocus"];

type ResourceDrawerProps = {
    /** The resource to show. Stays set while the drawer animates closed; null before the first selection. */
    resource: TreeNode | null;
    /** Path from the root to the resource (root, category, resource), shown as the breadcrumb. */
    breadcrumbs: TreeNode[];
    /** Whether the drawer is open. Kept separate from `resource` so content doesn't blank while closing. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * What gets focus when the drawer has finished closing (Base UI's `finalFocus`). A function can
     * return an element to focus, `true` for the default behavior, or `false` to leave focus alone.
     */
    finalFocus?: FinalFocus;
    /** Set of favorited resource ids. */
    favorites: Set<string>;
    toggleFavorite: (id: string) => void;
};

/**
 * Bottom drawer showing the details of a resource: breadcrumb, description,
 * action buttons (open, copy URL, favorite), tags, "best for" and cautions.
 * It receives plain data (no d3 node), and its open state is controlled separately
 * from its content, so the content stays visible while the drawer slides closed.
 */
export function ResourceDrawer({
    resource,
    breadcrumbs,
    open,
    onOpenChange,
    finalFocus,
    favorites,
    toggleFavorite,
}: ResourceDrawerProps) {

    // URL of the resource (undefined before anything has been selected)
    const url = resource?.url;
    // Whether the resource is currently a favorite
    const isFavorite = resource ? favorites.has(resource.id) : false;

    return (
        <Drawer
            snapPoints={SNAP_POINTS}
            showSwipeHandle
            open={open}
            onOpenChange={onOpenChange}
        >
            <DrawerContent finalFocus={finalFocus}>
                <DrawerHeader className="items-center">
                    <DrawerTitle className="text-2xl">
                        {resource?.name}
                    </DrawerTitle>

                    {/* Breadcrumb: the node's ancestors, separated by dots */}
                    <nav
                        className="text-xs pb-4 dark:text-amber-50"
                        aria-label="Breadcrumb"
                    >
                        {breadcrumbs.map((node, index) => (
                            <span
                                className="italic opacity-50"
                                key={node.id}
                            >
                                {index > 0 && " · "}
                                {node.name}
                            </span>
                        ))}
                    </nav>

                    <DrawerDescription className="max-w-2xl text-center font-mono text-[1.025rem] font-extralight">
                        {resource?.description}
                    </DrawerDescription>

                    {/* Action buttons */}
                    <div className="flex flex-wrap justify-center gap-3 pt-3">

                        {/* Opens the resource in a new tab (noopener/noreferrer for security).
                            Rendered as a disabled button when the URL isn't a valid https URL. */}
                        {isSafeUrl(url) ? (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonVariants({
                                    variant: "secondary",
                                    size: "lg",
                                    className: "bg-blue-600 px-8 py-4 hover:text-white hover:bg-blue-500",
                                })}
                            >
                                <ExternalLink />
                                Go to Link
                            </a>
                        ) : (
                            <Button variant="secondary" size="lg" disabled className="px-8 py-4">
                                <ExternalLink />
                                Go to Link
                            </Button>
                        )}

                        {/* Copies the resource URL to the clipboard and reports the result in a toast */}
                        {url && (
                            <Button
                                disabled={!isSafeUrl(url)}
                                variant="outline"
                                size="lg"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(url);
                                        toast.add({ type: "success", title: "URL copied", description: url });
                                    } catch (e) {
                                        console.warn("Failed to copy URL:", e instanceof Error ? e.message : e);
                                        toast.add({
                                            type: "error",
                                            title: "Couldn't copy the URL",
                                            description: "Copy it manually from the link instead.",
                                        });
                                    }
                                }}
                            >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy URL
                            </Button>
                        )}

                        {/* Adds/removes the resource from favorites; the star is filled when favorited */}
                        {resource && (
                            <Button
                                variant="outline"
                                size="lg"
                                onClick={() => {
                                    if (!resource) return;
                                    const { id, name } = resource;
                                    const wasFavorite = favorites.has(id); // read before toggling; state updates are async

                                    toggleFavorite(id);
                                    toast.add({
                                        type: "success",
                                        title: wasFavorite ? "Removed from favorites" : "Added to favorites",
                                        description: name,
                                    });
                                }}
                            >
                                <Star
                                    className={`mr-2 h-4 w-4 ${isFavorite
                                        ? "fill-yellow-400 text-yellow-400"
                                        : ""
                                        }`}
                                />
                                {isFavorite
                                    ? "Remove from Favorites"
                                    : "Add to Favorites"}
                            </Button>
                        )}
                    </div>
                </DrawerHeader>

                {/* Scrollable details; each section only renders if its data exists */}
                <div className="flex-1 space-y-4 overflow-y-auto p-4 md:px-8">
                    {/* Tags */}
                    {resource?.tags &&
                        resource.tags.length > 0 && (
                            <section className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                    {resource.tags.map((tag) => (
                                        <Badge
                                            variant="secondary"
                                            key={tag}
                                        >
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </section>
                        )}

                    {/* Best for: the ideal use case */}
                    {resource?.bestFor && (
                        <section className="rounded-xl border p-4">
                            <h3 className="mb-2 text-sm font-semibold">
                                Best for
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {resource.bestFor}
                            </p>
                        </section>
                    )}

                    {/* Considerations: caveats, highlighted with an amber tint */}
                    {resource?.caution && (
                        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                            <h3 className="mb-2 text-sm font-semibold">
                                Considerations
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {resource.caution}
                            </p>
                        </section>
                    )}
                </div>
            </DrawerContent>
        </Drawer >
    )
}
