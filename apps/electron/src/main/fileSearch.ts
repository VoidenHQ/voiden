/**
 * Port of IntelliJ's MinusculeMatcher for file-search scoring.
 *
 * Source (Apache 2.0):
 *   platform/util/text-matching/src/com/intellij/psi/codeStyle/
 *     - MinusculeMatcher.kt
 *     - MinusculeMatcherImpl.kt
 *     - NameUtilCore.kt
 *     - util/text/matching/CharArrayUtil.kt
 *
 * Kept as close to the original as practical. ASCII-only char helpers
 * (file paths are overwhelmingly ASCII); no Pinyin / keyboard-layout /
 * typo-tolerant / all-occurrences wrappers.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export enum MatchingMode {
    /**
     * Case-insensitive matching: pattern characters match regardless of case.
     *
     * Examples:
     * - Pattern "foo" matches: "foo", "Foo", "FOO", "fOo", "FooBar"
     * - Pattern "WL" matches: "WebLogic", "Weblogic", "weblogic"
     */
    IGNORE_CASE,

    /**
     * First letter exact match: the first non-wildcard letter of the pattern
     * must have matching case with the very first letter of the candidate name.
     * Remaining pattern letters match case-insensitively.
     *
     * Wildcards (`*` and space) at the start of the pattern are skipped when
     * determining the "first letter".
     *
     * Examples:
     * - Pattern "Foo" matches: "FooBar", "Foobar" but NOT "fooBar" (case mismatch at start)
     * - Pattern "foo" matches: "fooBar", "foobar" but NOT "FooBar" (case mismatch at start)
     * - Pattern " Foo" (space wildcard) matches: "FooBar" but NOT "fooBar" ('F' vs 'f' at name start)
     * - Pattern "*foo" matches: "fooBar" but NOT "FooBar" ('f' vs 'F' at name start)
     *
     * This mode is useful for completion scenarios where the user wants to distinguish
     * between different naming conventions (e.g., "String" class vs "string" keyword).
     */
    FIRST_LETTER,

    /**
     * Fully case-sensitive: all pattern characters must match case exactly.
     *
     * Examples:
     * - Pattern "WL" matches: "WebLogic" but NOT "Weblogic", "weblogic"
     * - Pattern "foo" matches: "foo" but NOT "Foo", "FOO"
     */
    MATCH_CASE,
}

/**
 * A matched fragment in text matching.
 *
 * Uses half-open interval `[startOffset, endOffset)`:
 * - [startOffset] is inclusive (first matched character)
 * - [endOffset] is exclusive (one past last matched character)
 *
 * `MatchedFragment(2, 5)` covers characters at indices 2, 3, 4.
 *
 * Higher [errorCount] means lower match score.
 *
 * @property startOffset inclusive start index
 * @property endOffset exclusive end index
 */
export interface MatchedFragment {
    startOffset: number;
    endOffset: number;
}

// -----------------------------------------------------------------------------
// Char helpers (ASCII)
// -----------------------------------------------------------------------------

function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}

function isUpperCase(c: string): boolean {
    return c >= "A" && c <= "Z";
}

function isLowerCase(c: string): boolean {
    return c >= "a" && c <= "z";
}

function isLetter(c: string): boolean {
    return isUpperCase(c) || isLowerCase(c);
}

function isLetterOrDigit(c: string): boolean {
    return isLetter(c) || isDigit(c);
}

function toUpperAscii(c: string): string {
    return isLowerCase(c) ? String.fromCharCode(c.charCodeAt(0) - 0x20) : c;
}

function toLowerAscii(c: string): string {
    return isUpperCase(c) ? String.fromCharCode(c.charCodeAt(0) + 0x20) : c;
}

// -----------------------------------------------------------------------------
// NameUtilCore
// -----------------------------------------------------------------------------

function isWordStart(text: string, i: number): boolean {
    const cur = text[i];
    const prev = i > 0 ? text[i - 1] : null;
    if (isUpperCase(cur)) {
        if (prev !== null && isUpperCase(prev)) {
            // not in the middle of an all-caps word
            const next = i + 1;
            return next < text.length && isLowerCase(text[next]);
        }
        return true;
    }
    if (isDigit(cur)) return true;
    if (!isLetter(cur)) return false;
    return i === 0 || !isLetterOrDigit(text[i - 1]);
}

function nextWord(text: string, start: number): number {
    const ch = text[start];
    if (!isLetterOrDigit(ch)) return start + 1;

    let i = start;
    while (i < text.length && isDigit(text[i])) i++;
    if (i > start) {
        // digits form a separate hump
        return i;
    }

    while (i < text.length && isUpperCase(text[i])) i++;
    if (i > start + 1) {
        // several consecutive uppercase letters form a hump
        if (i === text.length || !isLetter(text[i])) return i;
        return i - 1;
    }

    if (i === start) i += 1;
    while (i < text.length && isLetter(text[i]) && !isWordStart(text, i)) i++;
    return i;
}

// -----------------------------------------------------------------------------
// indexOf helpers (CharArrayUtil.kt)
// -----------------------------------------------------------------------------

function indexOfChar(
    s: string,
    c: string,
    start: number,
    end: number,
    ignoreCase: boolean
): number {
    const s1 = Math.max(start, 0);
    const e1 = Math.min(end, s.length);
    for (let i = s1; i < e1; i++) {
        if (
            s[i] === c ||
            (ignoreCase && toLowerAscii(s[i]) === toLowerAscii(c))
        ) {
            return i;
        }
    }
    return -1;
}

function indexOfInArray(
    arr: string[],
    c: string,
    start: number,
    end: number,
    ignoreCase: boolean
): number {
    const s1 = Math.max(start, 0);
    const e1 = Math.min(end, arr.length);
    for (let i = s1; i < e1; i++) {
        if (
            arr[i] === c ||
            (ignoreCase && toLowerAscii(arr[i]) === toLowerAscii(c))
        ) {
            return i;
        }
    }
    return -1;
}

function indexOfAny(
    s: string,
    chars: string[],
    start: number,
    end: number
): number {
    if (chars.length === 0) return -1;
    const s1 = Math.max(start, 0);
    const e1 = Math.min(end, s.length);
    for (let i = s1; i < e1; i++) {
        if (chars.includes(s[i])) return i;
    }
    return -1;
}

// -----------------------------------------------------------------------------
// MinusculeMatcher
// -----------------------------------------------------------------------------

const MAX_CAMEL_HUMP_MATCHING_LENGTH = 100;

function isWordSeparatorChar(c: string): boolean {
    return (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "_" ||
        c === "-" ||
        c === ":" ||
        c === "+" ||
        c === "."
    );
}

function isWildcardChar(c: string): boolean {
    return c === " " || c === "*";
}

export class MinusculeMatcher {
    private readonly myPattern: string[];
    private readonly isLowerCase: boolean[];
    private readonly isUpperCase: boolean[];
    private readonly isWordSeparator: boolean[];
    private readonly toUpperCase: string[];
    private readonly toLowerCase: string[];
    private readonly myHardSeparators: string[];
    private readonly myMatchingMode: MatchingMode;
    private readonly myMixedCase: boolean;
    private readonly myHasSeparators: boolean;
    private readonly myHasDots: boolean;
    private readonly myMeaningfulCharacters: string[];

    constructor(pattern: string, matchingMode: MatchingMode, hardSeparators: string) {
        // strip trailing "* "
        const p = pattern.endsWith("* ") ? pattern.slice(0, -2) : pattern;
        this.myPattern = p.split("");
        const n = this.myPattern.length;
        this.isLowerCase = new Array<boolean>(n);
        this.isUpperCase = new Array<boolean>(n);
        this.isWordSeparator = new Array<boolean>(n);
        this.toUpperCase = new Array<string>(n);
        this.toLowerCase = new Array<string>(n);
        this.myHardSeparators = hardSeparators.split("");
        this.myMatchingMode = matchingMode;

        const meaningful: string[] = [];
        let seenNonWildcard = false;
        let seenLowerCase = false;
        let seenUpperCaseNotImmediatelyAfterWildcard = false;
        let hasDots = false;
        let hasSeparators = false;

        for (let k = 0; k < n; k++) {
            const c = this.myPattern[k];
            const isWs = isWordSeparatorChar(c);
            const isUC = isUpperCase(c);
            const isLC = isLowerCase(c);
            const tU = toUpperAscii(c);
            const tL = toLowerAscii(c);
            if (isLC) seenLowerCase = true;
            if (c === ".") hasDots = true;
            if (seenNonWildcard && isUC) seenUpperCaseNotImmediatelyAfterWildcard = true;
            if (!isWildcardChar(c)) {
                seenNonWildcard = true;
                meaningful.push(tL, tU);
            }
            if (seenNonWildcard && isWs) hasSeparators = true;

            this.isWordSeparator[k] = isWs;
            this.isUpperCase[k] = isUC;
            this.isLowerCase[k] = isLC;
            this.toUpperCase[k] = tU;
            this.toLowerCase[k] = tL;
        }

        this.myHasDots = hasDots;
        this.myMixedCase = seenLowerCase && seenUpperCaseNotImmediatelyAfterWildcard;
        this.myHasSeparators = hasSeparators;
        this.myMeaningfulCharacters = meaningful;
    }

    get pattern(): string {
        return this.myPattern.join("");
    }

    match(name: string): MatchedFragment[] | null {
        if (name.length < this.myMeaningfulCharacters.length / 2) return null;
        if (this.myPattern.length > MAX_CAMEL_HUMP_MATCHING_LENGTH) {
            return this.matchBySubstring(name);
        }
        if (!nameContainsAllMeaningfulCharsInOrder(name, this.myMeaningfulCharacters)) {
            return null;
        }
        const res = this.matchWildcards(name, 0, 0);
        return res === null ? null : res.slice().reverse();
    }

    matchingDegree(
        name: string,
        valueStartCaseMatch: boolean,
        fragments: MatchedFragment[]
    ): number {
        return calculateHumpedMatchingScore(
            this.myPattern,
            name,
            valueStartCaseMatch,
            fragments,
            this.isLowerCase,
            this.isUpperCase,
            this.myHardSeparators
        );
    }

    matches(name: string): boolean {
        return this.match(name) !== null;
    }

    // ---------- private ----------

    private matchBySubstring(name: string): MatchedFragment[] | null {
        const meaningfulCharactersCount = this.myMeaningfulCharacters.length / 2;
        if (name.length < meaningfulCharactersCount) return null;

        if (this.isPatternChar(0, "*")) {
            for (let i = 0; i <= name.length - meaningfulCharactersCount; i++) {
                const len = this.meaningfulCharsMatchAt(name, i);
                if (len !== 0) return [{startOffset: i, endOffset: i + len}];
            }
            return null;
        }
        const len = this.meaningfulCharsMatchAt(name, 0);
        return len !== 0 ? [{startOffset: 0, endOffset: len}] : null;
    }

    private meaningfulCharsMatchAt(name: string, nameIndex: number): number {
        let mci = 0;
        let np = nameIndex;
        while (np < name.length && mci + 1 < this.myMeaningfulCharacters.length) {
            const c = name[np];
            if (
                c === this.myMeaningfulCharacters[mci] ||
                c === this.myMeaningfulCharacters[mci + 1]
            ) {
                mci += 2;
                np += 1;
            } else if (isWildcardChar(c)) {
                np += 1;
            } else {
                return 0;
            }
        }
        return np - nameIndex;
    }

    /**
     * After a wildcard (* or space), search for the first non-wildcard pattern
     * character in the name starting from nameIndex and try to matchFragment for it.
     */
    private matchWildcards(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): MatchedFragment[] | null {
        let pi = patternIndex;
        if (nameIndex < 0) return null;
        if (!this.isWildcardAt(pi)) {
            return pi === this.myPattern.length
                ? []
                : this.matchFragment(name, pi, nameIndex);
        }

        do {
            pi++;
        } while (this.isWildcardAt(pi));

        if (pi === this.myPattern.length) {
            // trailing space should match if the pattern ends with the last word part,
            // or only its first hump character
            if (
                this.isTrailingSpacePattern() &&
                nameIndex !== name.length &&
                (pi < 2 || !this.isUpperCaseOrDigit(pi - 2))
            ) {
                const spaceIndex = name.indexOf(" ", nameIndex);
                if (spaceIndex >= 0) {
                    return [{startOffset: spaceIndex, endOffset: spaceIndex + 1}];
                }
                return null;
            }
            return [];
        }

        return this.matchSkippingWords(
            name,
            pi,
            this.findNextPatternCharOccurrence(name, nameIndex, pi),
            true
        );
    }

    private isTrailingSpacePattern(): boolean {
        return this.isPatternChar(this.myPattern.length - 1, " ");
    }

    private isUpperCaseOrDigit(patternIndex: number): boolean {
        return this.isUpperCase[patternIndex] || isDigit(this.myPattern[patternIndex]);
    }

    /**
     * Enumerates places in name that could be matched by the pattern at patternIndex
     * and invokes matchFragment at those candidate positions.
     */
    private matchSkippingWords(
        name: string,
        patternIndex: number,
        nameIndex: number,
        allowSpecialChars: boolean
    ): MatchedFragment[] | null {
        let ni = nameIndex;
        let maxFoundLength = 0;
        while (ni >= 0) {
            let fragmentLength = 0;
            if (this.seemsLikeFragmentStart(name, patternIndex, ni)) {
                fragmentLength = this.maxMatchingFragment(name, patternIndex, ni);
            }

            // match the remaining pattern only if we haven't already seen a fragment of
            // the same (or bigger) length — otherwise we already tried to match remaining
            // pattern letters after it and failed; less remaining name ⇒ will fail again
            if (
                fragmentLength > maxFoundLength ||
                (ni + fragmentLength === name.length && this.isTrailingSpacePattern())
            ) {
                if (!this.isMiddleMatch(name, patternIndex, ni)) {
                    maxFoundLength = fragmentLength;
                }
                const ranges = this.matchInsideFragment(
                    name,
                    patternIndex,
                    ni,
                    fragmentLength
                );
                if (ranges !== null) return ranges;
            }
            const next = this.findNextPatternCharOccurrence(name, ni + 1, patternIndex);
            ni = allowSpecialChars
                ? next
                : this.checkForSpecialChars(name, ni + 1, next, patternIndex);
        }
        return null;
    }

    private findNextPatternCharOccurrence(
        name: string,
        startAt: number,
        patternIndex: number
    ): number {
        if (
            !this.isPatternChar(patternIndex - 1, "*") &&
            !this.isWordSeparator[patternIndex]
        ) {
            return this.indexOfWordStart(name, patternIndex, startAt);
        }
        return this.indexOfIgnoreCase(name, startAt, patternIndex);
    }

    private checkForSpecialChars(
        name: string,
        start: number,
        end: number,
        patternIndex: number
    ): number {
        if (end < 0) return -1;
        // pattern humps are allowed to match in words separated by " ()", lowercase aren't
        if (
            !this.myHasSeparators &&
            !this.myMixedCase &&
            indexOfAny(name, this.myHardSeparators, start, end) !== -1
        ) {
            return -1;
        }
        // if the user typed a dot, don't skip other dots between humps; but one
        // pattern dot may match several name dots
        if (
            this.myHasDots &&
            !this.isPatternChar(patternIndex - 1, ".") &&
            indexOfChar(name, ".", start, end, false) !== -1
        ) {
            return -1;
        }
        return end;
    }

    private seemsLikeFragmentStart(
        name: string,
        patternIndex: number,
        nextOccurrence: number
    ): boolean {
        // uppercase should match either uppercase or a word start
        return (
            !this.isUpperCase[patternIndex] ||
            isUpperCase(name[nextOccurrence]) ||
            isWordStart(name, nextOccurrence) ||
            // accept uppercase matching lowercase if the whole prefix is uppercase
            // and case sensitivity allows that
            (!this.myMixedCase && this.myMatchingMode !== MatchingMode.MATCH_CASE)
        );
    }

    private charEquals(
        patternChar: string,
        patternIndex: number,
        c: string,
        ignoreCase: boolean
    ): boolean {
        return (
            patternChar === c ||
            (ignoreCase &&
                (this.toLowerCase[patternIndex] === c ||
                    this.toUpperCase[patternIndex] === c))
        );
    }

    private matchFragment(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): MatchedFragment[] | null {
        const fragmentLength = this.maxMatchingFragment(name, patternIndex, nameIndex);
        return fragmentLength === 0
            ? null
            : this.matchInsideFragment(name, patternIndex, nameIndex, fragmentLength);
    }

    private maxMatchingFragment(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): number {
        if (!this.isFirstCharMatching(name, nameIndex, patternIndex)) return 0;
        let i = 1;
        const ignoreCase = this.myMatchingMode !== MatchingMode.MATCH_CASE;
        while (
            nameIndex + i < name.length &&
            patternIndex + i < this.myPattern.length
            ) {
            const nameChar = name[nameIndex + i];
            if (
                !this.charEquals(
                    this.myPattern[patternIndex + i],
                    patternIndex + i,
                    nameChar,
                    ignoreCase
                )
            ) {
                if (this.isSkippingDigitBetweenPatternDigits(patternIndex + i, nameChar)) {
                    return 0;
                }
                break;
            }
            i++;
        }
        return i;
    }

    private isSkippingDigitBetweenPatternDigits(
        patternIndex: number,
        nameChar: string
    ): boolean {
        return (
            isDigit(this.myPattern[patternIndex]) &&
            isDigit(this.myPattern[patternIndex - 1]) &&
            isDigit(nameChar)
        );
    }

    // we've found the longest fragment matching pattern and name
    private matchInsideFragment(
        name: string,
        patternIndex: number,
        nameIndex: number,
        fragmentLength: number
    ): MatchedFragment[] | null {
        // exact middle matches have to be at least of length 3, to prevent too many
        // irrelevant matches
        const minFragment = this.isMiddleMatch(name, patternIndex, nameIndex) ? 3 : 1;
        const camel = this.improveCamelHumps(
            name,
            patternIndex,
            nameIndex,
            fragmentLength,
            minFragment
        );
        return (
            camel ??
            this.findLongestMatchingPrefix(
                name,
                patternIndex,
                nameIndex,
                fragmentLength,
                minFragment
            )
        );
    }

    private isMiddleMatch(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): boolean {
        return (
            this.isPatternChar(patternIndex - 1, "*") &&
            !this.isWildcardAt(patternIndex + 1) &&
            isLetterOrDigit(name[nameIndex]) &&
            !isWordStart(name, nameIndex)
        );
    }

    private findLongestMatchingPrefix(
        name: string,
        patternIndex: number,
        nameIndex: number,
        fragmentLength: number,
        minFragment: number
    ): MatchedFragment[] | null {
        if (patternIndex + fragmentLength >= this.myPattern.length) {
            return [{startOffset: nameIndex, endOffset: nameIndex + fragmentLength}];
        }

        // try to match the remainder of pattern with the remainder of name;
        // if longest match fails, try shorter matches
        let i = fragmentLength;
        while (i >= minFragment || (i > 0 && this.isWildcardAt(patternIndex + i))) {
            let ranges: MatchedFragment[] | null;
            if (this.isWildcardAt(patternIndex + i)) {
                ranges = this.matchWildcards(name, patternIndex + i, nameIndex + i);
            } else {
                let nextOccurrence = this.findNextPatternCharOccurrence(
                    name,
                    nameIndex + i + 1,
                    patternIndex + i
                );
                nextOccurrence = this.checkForSpecialChars(
                    name,
                    nameIndex + i,
                    nextOccurrence,
                    patternIndex + i
                );
                ranges =
                    nextOccurrence >= 0
                        ? this.matchSkippingWords(name, patternIndex + i, nextOccurrence, false)
                        : null;
            }
            if (ranges !== null) {
                return appendRange(ranges, nameIndex, i);
            }
            i--;
        }
        return null;
    }

    /**
     * When pattern is "CU" and name is "CurrentUser", we already have a prefix "Cu"
     * that matches, but we try to find uppercase "U" later in name for a better
     * matching degree.
     */
    private improveCamelHumps(
        name: string,
        patternIndex: number,
        nameIndex: number,
        maxFragment: number,
        minFragment: number
    ): MatchedFragment[] | null {
        for (let i = minFragment; i < maxFragment; i++) {
            if (
                this.isUppercasePatternVsLowercaseNameChar(
                    name,
                    patternIndex + i,
                    nameIndex + i
                )
            ) {
                const ranges = this.findUppercaseMatchFurther(
                    name,
                    patternIndex + i,
                    nameIndex + i
                );
                if (ranges !== null) return appendRange(ranges, nameIndex, i);
            }
        }
        return null;
    }

    private isUppercasePatternVsLowercaseNameChar(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): boolean {
        return (
            this.isUpperCase[patternIndex] && this.myPattern[patternIndex] !== name[nameIndex]
        );
    }

    private findUppercaseMatchFurther(
        name: string,
        patternIndex: number,
        nameIndex: number
    ): MatchedFragment[] | null {
        const nextWordStart = this.indexOfWordStart(name, patternIndex, nameIndex);
        return this.matchWildcards(name, patternIndex, nextWordStart);
    }

    private isFirstCharMatching(
        name: string,
        nameIndex: number,
        patternIndex: number
    ): boolean {
        if (nameIndex >= name.length) return false;
        const ignoreCase = this.myMatchingMode !== MatchingMode.MATCH_CASE;
        const patternChar = this.myPattern[patternIndex];
        if (!this.charEquals(patternChar, patternIndex, name[nameIndex], ignoreCase)) {
            return false;
        }
        return !(
            this.myMatchingMode === MatchingMode.FIRST_LETTER &&
            (patternIndex === 0 || (patternIndex === 1 && this.isWildcardAt(0))) &&
            this.hasCase(patternIndex) &&
            this.isUpperCase[patternIndex] !== isUpperCase(name[0])
        );
    }

    private hasCase(patternIndex: number): boolean {
        return this.isUpperCase[patternIndex] || this.isLowerCase[patternIndex];
    }

    private isWildcardAt(patternIndex: number): boolean {
        return (
            patternIndex >= 0 &&
            patternIndex < this.myPattern.length &&
            isWildcardChar(this.myPattern[patternIndex])
        );
    }

    private isPatternChar(patternIndex: number, c: string): boolean {
        return (
            patternIndex >= 0 &&
            patternIndex < this.myPattern.length &&
            this.myPattern[patternIndex] === c
        );
    }

    private indexOfWordStart(
        name: string,
        patternIndex: number,
        startFrom: number
    ): number {
        const p = this.myPattern[patternIndex];
        if (
            startFrom >= name.length ||
            (this.myMixedCase &&
                this.isLowerCase[patternIndex] &&
                !(patternIndex > 0 && this.isWordSeparator[patternIndex - 1]))
        ) {
            return -1;
        }
        let i = startFrom;
        const isSpecialSymbol = !isLetterOrDigit(p);
        while (true) {
            i = this.indexOfIgnoreCase(name, i, patternIndex);
            if (i < 0) return -1;
            if (isSpecialSymbol || isWordStart(name, i)) return i;
            i++;
        }
    }

    private indexOfIgnoreCase(
        name: string,
        fromIndex: number,
        patternIndex: number
    ): number {
        const pU = this.toUpperCase[patternIndex];
        const pL = this.toLowerCase[patternIndex];
        for (let i = fromIndex; i < name.length; i++) {
            const c = name[i];
            if (c === pU || c === pL) return i;
        }
        return -1;
    }
}

// -----------------------------------------------------------------------------
// Scoring (MinusculeMatcher.calculateHumpedMatchingScore)
// -----------------------------------------------------------------------------

function calculateHumpedMatchingScore(
    pattern: string[],
    name: string,
    valueStartCaseMatch: boolean,
    fragments: MatchedFragment[],
    isLowerCaseArr: boolean[],
    isUpperCaseArr: boolean[],
    myHardSeparators: string[]
): number {
    if (fragments.length === 0) return 0;

    const first = fragments[0];
    const startMatch = first.startOffset === 0;
    const valuedStartMatch = startMatch && valueStartCaseMatch;

    let matchingCase = 0;
    let p = -1;
    let skippedHumps = 0;
    let nextHumpStart = 0;
    let humpStartMatchedUpperCase = false;

    for (const range of fragments) {
        for (let i = range.startOffset; i < range.endOffset; i++) {
            const afterGap = i === range.startOffset && first !== range;
            let isHumpStart = false;
            while (nextHumpStart <= i) {
                if (nextHumpStart === i) {
                    isHumpStart = true;
                } else if (afterGap) {
                    skippedHumps++;
                }
                nextHumpStart =
                    nextHumpStart < name.length && isDigit(name[nextHumpStart])
                        ? nextHumpStart + 1 // treat each digit as a separate hump
                        : nextWord(name, nextHumpStart);
            }

            const c = name[i];
            p = indexOfInArray(pattern, c, p + 1, pattern.length, true);
            if (p < 0) break;

            if (isHumpStart) {
                humpStartMatchedUpperCase = c === pattern[p] && isUpperCaseArr[p];
            }

            matchingCase += evaluateCaseMatching(
                pattern,
                valuedStartMatch,
                p,
                humpStartMatchedUpperCase,
                i,
                afterGap,
                isHumpStart,
                c,
                isLowerCaseArr,
                isUpperCaseArr
            );
        }
    }

    const startIndex = first.startOffset;
    const afterSeparator = indexOfAny(name, myHardSeparators, 0, startIndex) >= 0;
    const wordStart =
        startIndex === 0 ||
        (isWordStart(name, startIndex) && !isWordStart(name, startIndex - 1));
    const finalMatch = fragments[fragments.length - 1].endOffset === name.length;

    return (
        (wordStart ? 1000 : 0) +
        matchingCase -
        fragments.length +
        -skippedHumps * 10 +
        (afterSeparator ? 0 : 2) +
        (startMatch ? 1 : 0) +
        (finalMatch ? 1 : 0)
    );
}

function evaluateCaseMatching(
    pattern: string[],
    valuedStartMatch: boolean,
    patternIndex: number,
    humpStartMatchedUpperCase: boolean,
    nameIndex: number,
    afterGap: boolean,
    isHumpStart: boolean,
    nameChar: string,
    isLowerCaseArr: boolean[],
    isUpperCaseArr: boolean[]
): number {
    if (afterGap && isHumpStart && isLowerCaseArr[patternIndex]) {
        // disprefer when there's a hump but nothing in the pattern indicates
        // the user meant it to be a hump
        return -10;
    }
    if (nameChar === pattern[patternIndex]) {
        if (isUpperCaseArr[patternIndex]) return 50; // user pressed Shift — reward it
        if (nameIndex === 0 && valuedStartMatch) return 150;
        if (isHumpStart) return 1;
        return 0;
    }
    if (isHumpStart) return -1;
    if (isLowerCaseArr[patternIndex] && humpStartMatchedUpperCase) return -1;
    return 0;
}

function nameContainsAllMeaningfulCharsInOrder(
    name: string,
    meaningfulChars: string[]
): boolean {
    let mci = 0;
    let ni = 0;
    while (mci + 1 < meaningfulChars.length) {
        if (ni >= name.length) return false;
        const c1 = meaningfulChars[mci];
        const indexOf1 = name.indexOf(c1, ni);
        if (indexOf1 === ni) {
            ni = indexOf1 + 1;
        } else {
            const c2 = meaningfulChars[mci + 1];
            if (c1 === c2) {
                if (indexOf1 < 0) return false;
                ni = indexOf1 + 1;
            } else {
                const indexOf2 = name.indexOf(c2, ni);
                if (indexOf1 >= 0 && indexOf2 >= 0) {
                    ni = Math.min(indexOf1, indexOf2) + 1;
                } else if (indexOf1 >= 0) {
                    ni = indexOf1 + 1;
                } else if (indexOf2 >= 0) {
                    ni = indexOf2 + 1;
                } else {
                    return false;
                }
            }
        }
        mci += 2;
    }
    return true;
}

function appendRange(
    ranges: MatchedFragment[],
    from: number,
    length: number
): MatchedFragment[] {
    if (ranges.length === 0) {
        return [{startOffset: from, endOffset: from + length}];
    }
    const last = ranges[ranges.length - 1];
    if (last.startOffset === from + length) {
        ranges[ranges.length - 1] = {startOffset: from, endOffset: last.endOffset};
    } else {
        ranges.push({startOffset: from, endOffset: from + length});
    }
    return ranges;
}

// -----------------------------------------------------------------------------
// Public scoring API
// -----------------------------------------------------------------------------

/**
 * Bonus added to scores where the match landed in the filename portion of the
 * path (vs. somewhere in the directory). IntelliJ's matchingDegree already
 * gives +1000 for a word-start match; this bonus dominates so filename hits
 * always outrank directory hits when both exist.
 */
const FILENAME_BONUS = 10000;

export interface FileMatchResult {
    score: number;
    pathFragments: MatchedFragment[];
    filenameFragments: MatchedFragment[];
}

const NO_MATCH: FileMatchResult = {score: 0, pathFragments: [], filenameFragments: []};

/**
 * Score a list of file paths against a query. Builds two matchers once and
 * reuses them across the corpus — the constructor allocates several arrays
 * proportional to pattern length.
 *
 * Returns a parallel array: `result[i]` is the score for `filePaths[i]`.
 * Non-matches carry `score: 0` and empty fragment arrays.
 *
 * Pass `currentFilePath` (relative, same coordinate space as `filePaths`) to
 * boost files whose directory is an ancestor or descendant of the current
 * file's directory. Bonus decays with each extra path-segment of distance.
 */
export function scoreFiles(query: string, filePaths: string[], currentDir?: string): FileMatchResult[] {
    const matcher = new MinusculeMatcher("* " + query, MatchingMode.IGNORE_CASE, "");
    const allowFileOnlyMatches = !query.includes("/");
    return filePaths.map((p) => scoreFileWith(matcher, p, allowFileOnlyMatches, currentDir));
}

/**
 * Score a file path using prebuilt path + filename matchers. Path-separator
 * agnostic — takes whichever of `/` or `\` appears last as the filename split.
 * Filename bonus applies when the filename-only matcher matches the basename.
 */
function scoreFileWith(
    matcher: MinusculeMatcher,
    filePath: string,
    allowFileOnlyMatches: boolean,
    currentFileDir?: string,
): FileMatchResult {
    const filePartStart = filePath.lastIndexOf("/") + 1;

    if (allowFileOnlyMatches) {
        const filenameOnly = filePath.slice(filePartStart);
        const filenameMatched = matcher.match(filenameOnly);

        if (filenameMatched !== null) {
            let score = matcher.matchingDegree(filenameOnly, false, filenameMatched);
            score += FILENAME_BONUS;
            if (currentFileDir) score += computeProximityBonus(currentFileDir, filePath);
            return {
                score,
                pathFragments: [],
                filenameFragments: filenameMatched,
            }
        }
    }


    const pathMatched = matcher.match(filePath);
    if (pathMatched !== null) {
        let score = matcher.matchingDegree(filePath, false, pathMatched);
        if (currentFileDir) score += computeProximityBonus(currentFileDir, filePath);
        const pathFragments: MatchedFragment[] = [];
        const filenameFragments: MatchedFragment[] = [];
        for (const {startOffset, endOffset} of pathMatched) {
            if (startOffset >= filePartStart) {
                score += 100
                filenameFragments.push({startOffset: startOffset - filePartStart, endOffset: endOffset - filePartStart});
            } else if (endOffset <= filePartStart) {
                pathFragments.push({startOffset, endOffset});
            } else {
                score += 100
                pathFragments.push({startOffset, endOffset: filePartStart});
                filenameFragments.push({startOffset: 0, endOffset: endOffset - filePartStart});
            }
        }

        return {
            score,
            pathFragments,
            filenameFragments,
        }
    }

    return NO_MATCH;
}

function computeProximityBonus(currentDir: string, candidatePath: string): number {
    const dirOf = (p: string) => {
        const i = p.lastIndexOf("/");
        return i >= 0 ? p.slice(0, i) : "";
    };
    const candidateDir = dirOf(candidatePath);
    const currentSegs = currentDir ? currentDir.split("/") : [];
    const candidateSegs = candidateDir ? candidateDir.split("/") : [];
    let common = 0;
    const maxCommon = Math.min(currentSegs.length, candidateSegs.length);
    while (common < maxCommon && currentSegs[common] === candidateSegs[common]) common++;
    const distance = (currentSegs.length - common) + (candidateSegs.length - common);
    return Math.max(0, 500 - distance * 100);
}
