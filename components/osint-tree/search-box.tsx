"use client";

import { useId, useRef, useState } from "react";
import { Search, Star, X } from "lucide-react";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "@/components/ui/input-group";
import {
    FAVORITES_TOKEN,
    composeQuery,
    parseQuery,
    stripFavoritesToken,
    suggestFavoritesToken,
} from "./filter-tree";

type Props = {
    /** The raw query, including the "@favorites" token when the filter is on. */
    value: string;
    onChange: (value: string) => void;
    /** Id of the element that describes the search results (e.g. the live region). */
    describedBy?: string;
};

/**
 * The search field. The raw query stays a single string (so the rest of the app is
 * unchanged), but a leading "@favorites" token is shown as a colored chip and the text
 * box only holds what comes after it. While the user types "@..." a one-item suggestion
 * list offers the token; Enter or a click turns it into the chip. Backspace in an empty
 * text box removes the chip.
 */
export function SearchBox({ value, onChange, describedBy }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const listId = useId();
    const optionId = useId();
    const [focused, setFocused] = useState(false);
    // Set by Escape; cleared as soon as the text changes
    const [dismissed, setDismissed] = useState(false);

    const { favoritesOnly } = parseQuery(value);
    const text = stripFavoritesToken(value);
    const suggestion = favoritesOnly ? null : suggestFavoritesToken(text);
    const open = focused && !dismissed && suggestion !== null;

    const changeText = (next: string) => {
        setDismissed(false);
        onChange(composeQuery(favoritesOnly, next));
    };

    // The whole text box is the partly typed token, so it is replaced by the chip
    const acceptSuggestion = () => {
        setDismissed(false);
        onChange(composeQuery(true, ""));
        inputRef.current?.focus();
    };

    const removeChip = () => {
        onChange(text);
        inputRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && open) {
            event.preventDefault();
            acceptSuggestion();
        } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setDismissed(true);
        } else if (event.key === "Backspace" && favoritesOnly && text === "") {
            event.preventDefault();
            removeChip();
        }
    };

    return (
        <div className="relative w-full sm:w-80">
            <InputGroup>
                <InputGroupAddon>
                    <Search aria-hidden="true" />
                    {favoritesOnly && (
                        <span
                            data-slot="favorites-chip"
                            className="inline-flex items-center gap-1 rounded-md bg-yellow-400/20 py-0.5 pr-0.5 pl-1.5 text-xs font-medium text-yellow-800 ring-1 ring-yellow-500/30 dark:text-yellow-300"
                        >
                            <Star aria-hidden="true" className="size-3 fill-current" />
                            {FAVORITES_TOKEN}
                            <button
                                type="button"
                                aria-label="Remove favorites filter"
                                onClick={removeChip}
                                className="rounded p-0.5 hover:bg-yellow-500/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                <X aria-hidden="true" className="size-3" />
                            </button>
                        </span>
                    )}
                </InputGroupAddon>

                <InputGroupInput
                    ref={inputRef}
                    name="searchByResource"
                    value={text}
                    onChange={(event) => changeText(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="Search resources or @favorites [term]..."
                    aria-label="Search OSINT resources"
                    aria-describedby={describedBy}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-activedescendant={open ? optionId : undefined}
                    autoComplete="off"
                    spellCheck={false}
                />

                {value.trim() !== "" && (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="Clear search"
                            onClick={() => {
                                onChange("");
                                inputRef.current?.focus();
                            }}
                        >
                            <X aria-hidden="true" />
                        </InputGroupButton>
                    </InputGroupAddon>
                )}
            </InputGroup>

            {open && (
                <ul
                    id={listId}
                    role="listbox"
                    aria-label="Search suggestions"
                    className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
                >
                    <li
                        id={optionId}
                        role="option"
                        aria-selected="true"
                        // Keep focus in the input: a click must not blur it (that would close the list first)
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={acceptSuggestion}
                        className="flex cursor-pointer items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm text-accent-foreground"
                    >
                        <Star aria-hidden="true" className="size-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-medium">{FAVORITES_TOKEN}</span>
                        <span className="text-muted-foreground">Show only your favorites</span>
                    </li>
                </ul>
            )}
        </div>
    );
}
