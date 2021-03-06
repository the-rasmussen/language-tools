import {
    Position,
    Range,
    TextEdit,
    Location,
    CompletionItem,
    Hover,
    Diagnostic,
    ColorInformation,
    ColorPresentation,
    SymbolInformation,
    LocationLink,
    TextDocumentEdit,
    CodeAction,
} from 'vscode-languageserver';
import { TagInformation, offsetAt, positionAt } from './utils';
import { SourceMapConsumer } from 'source-map';
import { Logger } from '../../logger';

export interface DocumentMapper {
    /**
     * Map the generated position to the original position
     * @param generatedPosition Position in fragment
     */
    getOriginalPosition(generatedPosition: Position): Position;

    /**
     * Map the original position to the generated position
     * @param originalPosition Position in parent
     */
    getGeneratedPosition(originalPosition: Position): Position;

    /**
     * Returns true if the given original position is inside of the generated map
     * @param pos Position in original
     */
    isInGenerated(pos: Position): boolean;

    /**
     * Get document URL
     */
    getURL(): string;

    /**
     * Implement this if you need teardown logic before this mapper gets cleaned up.
     */
    destroy?(): void;
}

/**
 * Does not map, returns positions as is.
 */
export class IdentityMapper implements DocumentMapper {
    constructor(private url: string) {}

    getOriginalPosition(generatedPosition: Position): Position {
        return generatedPosition;
    }

    getGeneratedPosition(originalPosition: Position): Position {
        return originalPosition;
    }

    isInGenerated(): boolean {
        return true;
    }

    getURL(): string {
        return this.url;
    }
}

/**
 * Maps positions in a fragment relative to a parent.
 */
export class FragmentMapper implements DocumentMapper {
    constructor(
        private originalText: string,
        private tagInfo: TagInformation,
        private url: string,
    ) {}

    getOriginalPosition(generatedPosition: Position): Position {
        const parentOffset = this.offsetInParent(offsetAt(generatedPosition, this.tagInfo.content));
        return positionAt(parentOffset, this.originalText);
    }

    private offsetInParent(offset: number): number {
        return this.tagInfo.start + offset;
    }

    getGeneratedPosition(originalPosition: Position): Position {
        const fragmentOffset = offsetAt(originalPosition, this.originalText) - this.tagInfo.start;
        return positionAt(fragmentOffset, this.tagInfo.content);
    }

    isInGenerated(pos: Position): boolean {
        const offset = offsetAt(pos, this.originalText);
        return offset >= this.tagInfo.start && offset <= this.tagInfo.end;
    }

    getURL(): string {
        return this.url;
    }
}

export class SourceMapDocumentMapper implements DocumentMapper {
    constructor(protected consumer: SourceMapConsumer, protected sourceUri: string) {}

    getOriginalPosition(generatedPosition: Position): Position {
        const mapped = this.consumer.originalPositionFor({
            line: generatedPosition.line + 1,
            column: generatedPosition.character,
        });

        if (!mapped) {
            return { line: -1, character: -1 };
        }

        if (mapped.line === 0) {
            Logger.log('Got 0 mapped line from', generatedPosition, 'col was', mapped.column);
        }

        return {
            line: (mapped.line || 0) - 1,
            character: mapped.column || 0,
        };
    }

    getGeneratedPosition(originalPosition: Position): Position {
        const mapped = this.consumer.generatedPositionFor({
            line: originalPosition.line + 1,
            column: originalPosition.character,
            source: this.sourceUri,
        });

        if (!mapped) {
            return { line: -1, character: -1 };
        }

        const result = {
            line: (mapped.line || 0) - 1,
            character: mapped.column || 0,
        };

        if (result.line < 0) {
            return result;
        }

        return result;
    }

    isInGenerated(position: Position): boolean {
        const generated = this.getGeneratedPosition(position);
        return generated.line >= 0;
    }

    getURL(): string {
        return this.sourceUri;
    }

    /**
     * Needs to be called when source mapper is no longer needed in order to prevent memory leaks.
     */
    destroy() {
        this.consumer.destroy();
    }
}

export function mapRangeToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    range: Range,
): Range {
    return Range.create(
        fragment.getOriginalPosition(range.start),
        fragment.getOriginalPosition(range.end),
    );
}

export function mapRangeToGenerated(fragment: DocumentMapper, range: Range): Range {
    return Range.create(
        fragment.getGeneratedPosition(range.start),
        fragment.getGeneratedPosition(range.end),
    );
}

export function mapTextEditToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    edit: TextEdit,
): TextEdit {
    return { ...edit, range: mapRangeToOriginal(fragment, edit.range) };
}

export function mapLocationToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    loc: Location,
): Location {
    return { ...loc, range: mapRangeToOriginal(fragment, loc.range) };
}

export function mapCompletionItemToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    item: CompletionItem,
): CompletionItem {
    if (!item.textEdit) {
        return item;
    }

    return { ...item, textEdit: mapTextEditToOriginal(fragment, item.textEdit) };
}

export function mapHoverToParent(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    hover: Hover,
): Hover {
    if (!hover.range) {
        return hover;
    }

    return { ...hover, range: mapRangeToOriginal(fragment, hover.range) };
}

export function mapDiagnosticToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    diagnostic: Diagnostic,
): Diagnostic {
    return { ...diagnostic, range: mapRangeToOriginal(fragment, diagnostic.range) };
}

export function mapDiagnosticToGenerated(
    fragment: DocumentMapper,
    diagnostic: Diagnostic,
): Diagnostic {
    return { ...diagnostic, range: mapRangeToGenerated(fragment, diagnostic.range) };
}

export function mapColorInformationToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    info: ColorInformation,
): ColorInformation {
    return { ...info, range: mapRangeToOriginal(fragment, info.range) };
}

export function mapColorPresentationToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    presentation: ColorPresentation,
): ColorPresentation {
    const item = {
        ...presentation,
    };

    if (item.textEdit) {
        item.textEdit = mapTextEditToOriginal(fragment, item.textEdit);
    }

    if (item.additionalTextEdits) {
        item.additionalTextEdits = item.additionalTextEdits.map((edit) =>
            mapTextEditToOriginal(fragment, edit),
        );
    }

    return item;
}

export function mapSymbolInformationToOriginal(
    fragment: Pick<DocumentMapper, 'getOriginalPosition'>,
    info: SymbolInformation,
): SymbolInformation {
    return { ...info, location: mapLocationToOriginal(fragment, info.location) };
}

export function mapLocationLinkToOriginal(
    fragment: DocumentMapper,
    def: LocationLink,
): LocationLink {
    return LocationLink.create(
        def.targetUri,
        fragment.getURL() === def.targetUri
            ? mapRangeToOriginal(fragment, def.targetRange)
            : def.targetRange,
        fragment.getURL() === def.targetUri
            ? mapRangeToOriginal(fragment, def.targetSelectionRange)
            : def.targetSelectionRange,
        def.originSelectionRange
            ? mapRangeToOriginal(fragment, def.originSelectionRange)
            : undefined,
    );
}

export function mapTextDocumentEditToOriginal(fragment: DocumentMapper, edit: TextDocumentEdit) {
    if (edit.textDocument.uri !== fragment.getURL()) {
        return edit;
    }

    return TextDocumentEdit.create(
        edit.textDocument,
        edit.edits.map((textEdit) => mapTextEditToOriginal(fragment, textEdit)),
    );
}

export function mapCodeActionToOriginal(fragment: DocumentMapper, codeAction: CodeAction) {
    return CodeAction.create(
        codeAction.title,
        {
            documentChanges: codeAction.edit!.documentChanges!.map((edit) =>
                mapTextDocumentEditToOriginal(fragment, edit as TextDocumentEdit),
            ),
        },
        codeAction.kind,
    );
}
