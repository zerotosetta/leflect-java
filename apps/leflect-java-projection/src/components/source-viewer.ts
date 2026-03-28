import { EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { SearchQuery, findNext, findPrevious, getSearchQuery, search, setSearchQuery } from "@codemirror/search";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { LitElement, PropertyValues, html } from "lit";
import { java } from "@codemirror/lang-java";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";

import type { ProjectionSourceLanguage, ProjectionSourceLocation, ProjectionTheme } from "../types";

const setAstHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();
const astHighlightDecoration = Decoration.mark({ class: "cm-astSelection" });
const astHighlightField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setAstHighlightEffect)) {
        continue;
      }
      if (!effect.value) {
        next = Decoration.none;
        continue;
      }
      const builder = new RangeSetBuilder<Decoration>();
      builder.add(effect.value.from, effect.value.to, astHighlightDecoration);
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const BASE_EXTENSIONS: Extension[] = [
  basicSetup,
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.lineWrapping,
  EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "rgb(var(--theme-editor-surface))",
      color: "rgb(var(--theme-editor-text))"
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "\"SFMono-Regular\", ui-monospace, Menlo, Monaco, Consolas, monospace",
      fontSize: "12px",
      lineHeight: "1.5"
    },
    ".cm-content": {
      padding: "12px 0"
    },
    ".cm-gutters": {
      minHeight: "100%",
      backgroundColor: "rgb(var(--theme-editor-panel))",
      color: "rgb(var(--theme-editor-gutter))",
      borderRight: "1px solid rgb(var(--theme-chrome-800))"
    },
    ".cm-activeLine": {
      backgroundColor: "rgb(var(--theme-editor-active-line) / 0.45)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgb(var(--theme-editor-active-line) / 0.85)"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgb(var(--theme-editor-selection) / 0.22)"
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "rgb(var(--theme-editor-selection))"
    },
    ".cm-searchMatch": {
      backgroundColor: "rgb(var(--theme-editor-search) / 0.18)",
      outline: "1px solid rgb(var(--theme-editor-search) / 0.45)"
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgb(var(--theme-editor-search-active) / 0.2)",
      outline: "1px solid rgb(var(--theme-editor-search-active) / 0.55)"
    },
    ".cm-astSelection": {
      backgroundColor: "rgb(var(--theme-graph-selection-fill) / 0.24)",
      outline: "1px solid rgb(var(--theme-graph-selection) / 0.7)",
      borderRadius: "2px"
    }
  }),
  astHighlightField,
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.modifier], color: "rgb(var(--theme-editor-keyword))", fontWeight: "600" },
      { tag: [t.string, t.special(t.string), t.regexp], color: "rgb(var(--theme-editor-string))" },
      { tag: [t.comment], color: "rgb(var(--theme-editor-comment))", fontStyle: "italic" },
      { tag: [t.className, t.typeName, t.namespace], color: "rgb(var(--theme-editor-type))" },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "rgb(var(--theme-editor-function))" },
      { tag: [t.variableName, t.self], color: "rgb(var(--theme-editor-variable))" },
      { tag: [t.number, t.bool, t.null], color: "rgb(var(--theme-editor-number))" },
      { tag: [t.operator, t.punctuation, t.bracket], color: "rgb(var(--theme-editor-operator))" },
      { tag: [t.tagName], color: "rgb(var(--theme-editor-tag))" },
      { tag: [t.propertyName, t.attributeName], color: "rgb(var(--theme-editor-property))" }
    ])
  )
];

class ProjectionSourceViewer extends LitElement {
  static properties = {
    value: { attribute: false },
    language: { attribute: false },
    theme: { attribute: false },
    highlightLocation: { attribute: false },
    searchValue: { state: true },
    matchCount: { state: true },
    activeMatchIndex: { state: true }
  };

  value = "";
  language: ProjectionSourceLanguage = "plain";
  theme: ProjectionTheme = "dark";
  highlightLocation?: ProjectionSourceLocation;
  searchValue = "";
  matchCount = 0;
  activeMatchIndex = 0;

  private editorView?: EditorView;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    const searchLabel = !this.searchValue
      ? "search"
      : this.matchCount === 0
        ? "0 matches"
        : this.activeMatchIndex > 0
          ? `${this.activeMatchIndex}/${this.matchCount}`
          : `${this.matchCount} matches`;

    return html`
      <div class="grid h-[32rem] grid-rows-[auto_minmax(0,1fr)] gap-1">
        <div class="flex items-center gap-1">
          <input
            data-search-input
            class="h-8 min-w-0 flex-1 rounded border border-chrome-700 bg-chrome-950 px-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-accent-500"
            placeholder="search in file"
            .value=${this.searchValue}
            @input=${this.onSearchInput}
            @keydown=${this.onSearchKeydown}
          />
          <span class="min-w-[5.5rem] rounded border border-chrome-800 px-2 py-1 text-center font-mono text-[10px] text-slate-400">${searchLabel}</span>
          <button
            class="rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-[10px] text-slate-300 hover:border-chrome-600 disabled:cursor-not-allowed disabled:opacity-50"
            ?disabled=${this.matchCount === 0}
            @click=${this.findPreviousMatch}
          >
            prev
          </button>
          <button
            class="rounded border border-chrome-700 bg-chrome-950 px-2 py-1 text-[10px] text-slate-300 hover:border-chrome-600 disabled:cursor-not-allowed disabled:opacity-50"
            ?disabled=${this.matchCount === 0}
            @click=${this.findNextMatch}
          >
            next
          </button>
        </div>
        <div data-editor class="min-h-0 overflow-hidden rounded border border-chrome-800 bg-[rgb(var(--theme-editor-surface))]"></div>
      </div>
    `;
  }

  override firstUpdated(): void {
    this.syncEditor();
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("value") || changedProperties.has("language") || changedProperties.has("theme")) {
      this.syncEditor();
      return;
    }
    if (changedProperties.has("highlightLocation")) {
      this.applyHighlightLocation();
    }
  }

  override disconnectedCallback(): void {
    this.editorView?.destroy();
    this.editorView = undefined;
    super.disconnectedCallback();
  }

  private syncEditor(): void {
    const host = this.querySelector<HTMLElement>("[data-editor]");
    if (!host) {
      return;
    }

    const state = EditorState.create({
      doc: this.value,
      extensions: [
        ...BASE_EXTENSIONS,
        search(),
        keymap.of([
          {
            key: "Mod-f",
            run: () => {
              this.focusSearchInput();
              return true;
            }
          },
          {
            key: "F3",
            run: () => this.findNextMatch()
          },
          {
            key: "Shift-F3",
            run: () => this.findPreviousMatch()
          }
        ]),
        this.languageExtension()
      ]
    });

    if (this.editorView) {
      this.editorView.setState(state);
      this.applySearchQuery(false);
      this.applyHighlightLocation();
      return;
    }

    this.editorView = new EditorView({
      state,
      parent: host
    });
    this.applySearchQuery(false);
    this.applyHighlightLocation();
  }

  private languageExtension(): Extension {
    if (this.language === "java") {
      return java();
    }
    if (this.language === "jsp") {
      return htmlLanguage();
    }
    return [];
  }

  private onSearchInput = (event: InputEvent) => {
    this.searchValue = (event.target as HTMLInputElement).value;
    this.applySearchQuery(true);
  };

  private onSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        this.findPreviousMatch();
        return;
      }
      this.findNextMatch();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.searchValue = "";
      this.applySearchQuery(false);
    }
  };

  private focusSearchInput(): void {
    const input = this.querySelector<HTMLInputElement>("[data-search-input]");
    input?.focus();
    input?.select();
  }

  private findNextMatch = (): boolean => {
    if (!this.editorView || this.matchCount === 0) {
      return false;
    }
    const moved = findNext(this.editorView);
    this.syncSearchStats();
    return moved;
  };

  private findPreviousMatch = (): boolean => {
    if (!this.editorView || this.matchCount === 0) {
      return false;
    }
    const moved = findPrevious(this.editorView);
    this.syncSearchStats();
    return moved;
  };

  private applySearchQuery(moveToFirstMatch: boolean): void {
    if (!this.editorView) {
      return;
    }

    const query = new SearchQuery({
      search: this.searchValue,
      caseSensitive: false,
      literal: true
    });

    this.editorView.dispatch({
      selection: moveToFirstMatch ? { anchor: 0 } : this.editorView.state.selection,
      effects: setSearchQuery.of(query)
    });

    if (moveToFirstMatch && query.valid && query.search) {
      findNext(this.editorView);
    }

    this.syncSearchStats();
  }

  private syncSearchStats(): void {
    if (!this.editorView) {
      this.matchCount = 0;
      this.activeMatchIndex = 0;
      return;
    }

    const query = getSearchQuery(this.editorView.state);
    if (!query.valid || !query.search) {
      this.matchCount = 0;
      this.activeMatchIndex = 0;
      return;
    }

    let matchCount = 0;
    let activeMatchIndex = 0;
    const selection = this.editorView.state.selection.main;
    const cursor = query.getCursor(this.editorView.state);

    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      matchCount += 1;
      if (selection.from === step.value.from && selection.to === step.value.to) {
        activeMatchIndex = matchCount;
      }
    }

    this.matchCount = matchCount;
    this.activeMatchIndex = activeMatchIndex;
  }

  private applyHighlightLocation(): void {
    if (!this.editorView) {
      return;
    }

    const range = this.locationToRange(this.highlightLocation);
    if (!range) {
      this.editorView.dispatch({
        effects: setAstHighlightEffect.of(null)
      });
      return;
    }

    this.editorView.dispatch({
      selection: EditorSelection.single(range.from, range.to),
      scrollIntoView: true,
      effects: setAstHighlightEffect.of(range)
    });
  }

  private locationToRange(location?: ProjectionSourceLocation): { from: number; to: number } | undefined {
    if (!location?.line || !location?.column || !this.editorView) {
      return undefined;
    }

    const state = this.editorView.state;
    if (location.line > state.doc.lines) {
      return undefined;
    }

    const startLine = state.doc.line(location.line);
    const from = Math.min(startLine.from + Math.max(location.column - 1, 0), startLine.to);
    const endLineNumber = location.endLine && location.endLine <= state.doc.lines
      ? location.endLine
      : location.line;
    const endLine = state.doc.line(endLineNumber);
    const rawTo = location.endColumn
      ? endLine.from + Math.max(location.endColumn, 0)
      : endLine.to;
    const to = Math.min(Math.max(rawTo, from + 1), endLine.to);

    return { from, to };
  }
}

customElements.define("projection-source-viewer", ProjectionSourceViewer);
