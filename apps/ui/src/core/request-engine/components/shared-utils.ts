import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import { pipe } from "fp-ts/lib/function.js";

import {
  GlobalEnvItem,
  SelectedEnvItem,
  TestDescriptor,
  TestResult,
} from "./types.js";

const REGEX_ENV_VAR = /<<([^>]*)>>/g; // "<<myVariable>>"

/**
 * How much times can we expand environment variables
 */
const ENV_MAX_EXPAND_LIMIT = 10;

/**
 * Error state when there is a suspected loop while
 * recursively expanding variables
 */
const ENV_EXPAND_LOOP = "ENV_EXPAND_LOOP" as const;

function parseTemplateStringE(
  str: string,
  variables: any | { secret: true; value: string; key: string }[],
  maskValue = false,
) {
  if (!variables || !str) {
    return E.right(str);
  }

  let result = str;
  let depth = 0;

  while (result.match(REGEX_ENV_VAR) != null && depth <= ENV_MAX_EXPAND_LIMIT) {
    result = decodeURI(encodeURI(result)).replace(REGEX_ENV_VAR, (_, p1) => {
      const variable = variables.find((x: any) => x && x.key === p1);

      if (variable && "value" in variable) {
        // Mask the value if it is a secret and explicitly specified
        if (variable.secret && maskValue) {
          return "*".repeat(
            (variable as { secret: true; value: string; key: string }).value
              .length,
          );
        }
        return variable.value;
      }

      return "";
    });
    depth++;
  }

  return depth > ENV_MAX_EXPAND_LIMIT
    ? E.left(ENV_EXPAND_LOOP)
    : E.right(result);
}

const getEnv = (envName: string, envs: TestResult["envs"]) => {
  return O.fromNullable(
    envs.selected.find((x: SelectedEnvItem) => x.key === envName) ??
      envs.global.find((x: GlobalEnvItem) => x.key === envName),
  );
};

const findEnvIndex = (
  envName: string,
  envList: SelectedEnvItem[] | GlobalEnvItem[],
): number => {
  return envList.findIndex(
    (envItem: SelectedEnvItem) => envItem.key === envName,
  );
};

const setEnv = (
  envName: string,
  envValue: string,
  envs: TestResult["envs"],
): TestResult["envs"] => {
  const { global, selected } = envs;

  const indexInSelected = findEnvIndex(envName, selected);
  const indexInGlobal = findEnvIndex(envName, global);

  if (indexInSelected >= 0) {
    const selectedEnv = selected[indexInSelected];
    if ("value" in selectedEnv) {
      selectedEnv.value = envValue;
    }
  } else if (indexInGlobal >= 0) {
    if ("value" in global[indexInGlobal]) {
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
      (global[indexInGlobal] as { value: string }).value = envValue;
    }
  } else {
    selected.push({
      key: envName,
      value: envValue,
      secret: false,
    });
  }

  return {
    global,
    selected,
  };
};

const unsetEnv = (
  envName: string,
  envs: TestResult["envs"],
): TestResult["envs"] => {
  const { global, selected } = envs;

  const indexInSelected = findEnvIndex(envName, selected);
  const indexInGlobal = findEnvIndex(envName, global);

  if (indexInSelected >= 0) {
    selected.splice(indexInSelected, 1);
  } else if (indexInGlobal >= 0) {
    global.splice(indexInGlobal, 1);
  }

  return {
    global,
    selected,
  };
};

// Compiles shared scripting API methods for use in both pre and post request scripts
const getSharedMethods = (envs: TestResult["envs"]) => {
  let updatedEnvs = envs;

  const envGetFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string");
    }

    const result = pipe(
      getEnv(key, updatedEnvs),
      O.fold(
        () => undefined,
        (env) => String(env.value),
      ),
    );

    return result;
  };

  const envGetResolveFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string");
    }

    const result = pipe(
      getEnv(key, updatedEnvs),
      E.fromOption(() => "INVALID_KEY" as const),

      E.map((e) =>
        pipe(
          parseTemplateStringE(e.value, [
            ...updatedEnvs.selected,
            ...updatedEnvs.global,
          ]), // If the recursive resolution failed, return the unresolved value
          E.getOrElse(() => e.value),
        ),
      ),
      E.map((x) => String(x)),

      E.getOrElseW(() => undefined),
    );

    return result;
  };

  const envSetFn = (key: any, value: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string");
    }

    if (typeof value !== "string") {
      throw new Error("Expected value to be a string");
    }

    updatedEnvs = setEnv(key, value, updatedEnvs);

    return undefined;
  };

  const envUnsetFn = (key: any) => {
    if (typeof key !== "string") {
      throw new Error("Expected key to be a string");
    }

    updatedEnvs = unsetEnv(key, updatedEnvs);

    return undefined;
  };

  const envResolveFn = (value: any) => {
    if (typeof value !== "string") {
      throw new Error("Expected value to be a string");
    }

    const result = pipe(
      parseTemplateStringE(value, [
        ...updatedEnvs.selected,
        ...updatedEnvs.global,
      ]),
      E.getOrElse(() => value),
    );

    return String(result);
  };

  return {
    methods: {
      env: {
        get: envGetFn,
        getResolve: envGetResolveFn,
        set: envSetFn,
        unset: envUnsetFn,
        resolve: envResolveFn,
      },
    },
    updatedEnvs,
  };
};

const getResolvedExpectValue = (expectVal: any) => {
  if (typeof expectVal !== "string") {
    return expectVal;
  }

  try {
    const parsedExpectVal = JSON.parse(expectVal);

    // Supplying non-primitive values is not permitted in the `isStringifiedWithinIsolate` property indicates that the object was stringified before executing the script from the isolate context
    // This is done to ensure a JSON string supplied as the "expectVal" is not parsed and preserved as is
    if (typeof parsedExpectVal === "object") {
      if (parsedExpectVal.isStringifiedWithinIsolate !== true) {
        return expectVal;
      }

      // For an array, the contents are stored in the `arr` property
      if (Array.isArray(parsedExpectVal.arr)) {
        return parsedExpectVal.arr;
      }

      delete parsedExpectVal.isStringifiedWithinIsolate;
      return parsedExpectVal;
    }

    return expectVal;
  } catch (_) {
    return expectVal;
  }
};

export function preventCyclicObjects(
  obj: Record<string, any>,
): E.Left<string> | E.Right<Record<string, any>> {
  let jsonString;

  try {
    jsonString = JSON.stringify(obj);
  } catch (e) {
    return E.left("Stringification failed");
  }

  try {
    const parsedJson = JSON.parse(jsonString);
    return E.right(parsedJson);
  } catch (err) {
    return E.left("Parsing failed");
  }
}

/**
 * Creates an Expectation object for use inside the sandbox
 * @param expectVal The expecting value of the expectation
 * @param negated Whether the expectation is negated (negative)
 * @param currTestStack The current state of the test execution stack
 * @returns Object with the expectation methods
 */
const createExpectation = (
  expectVal: any,
  negated: boolean,
  currTestStack: TestDescriptor[],
) => {
  const result: Record<string, unknown> = {};

  // Non-primitive values supplied are stringified in the isolate context
  const resolvedExpectVal = getResolvedExpectValue(expectVal);

  const toBeFn = (expectedVal: any) => {
    let assertion = resolvedExpectVal === expectedVal;

    if (negated) {
      assertion = !assertion;
    }

    const status = assertion ? "pass" : "fail";
    const message = `Expected '${resolvedExpectVal}' to${
      negated ? " not" : ""
    } be '${expectedVal}'`;

    currTestStack[currTestStack.length - 1].expectResults.push({
      status,
      message,
    });

    return undefined;
  };

  const toBeLevelXxx = (
    level: string,
    rangeStart: number,
    rangeEnd: number,
  ) => {
    const parsedExpectVal = parseInt(resolvedExpectVal);

    if (!Number.isNaN(parsedExpectVal)) {
      let assertion =
        parsedExpectVal >= rangeStart && parsedExpectVal <= rangeEnd;

      if (negated) {
        assertion = !assertion;
      }

      const status = assertion ? "pass" : "fail";
      const message = `Expected '${parsedExpectVal}' to${
        negated ? " not" : ""
      } be ${level}-level status`;

      currTestStack[currTestStack.length - 1].expectResults.push({
        status,
        message,
      });
    } else {
      const message = `Expected ${level}-level status but could not parse value '${resolvedExpectVal}'`;
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
    }

    return undefined;
  };

  const toBeLevel2xxFn = () => toBeLevelXxx("200", 200, 299);
  const toBeLevel3xxFn = () => toBeLevelXxx("300", 300, 399);
  const toBeLevel4xxFn = () => toBeLevelXxx("400", 400, 499);
  const toBeLevel5xxFn = () => toBeLevelXxx("500", 500, 599);

  const toBeTypeFn = (expectedType: any) => {
    if (
      [
        "string",
        "boolean",
        "number",
        "object",
        "undefined",
        "bigint",
        "symbol",
        "function",
      ].includes(expectedType)
    ) {
      let assertion = typeof resolvedExpectVal === expectedType;

      if (negated) {
        assertion = !assertion;
      }

      const status = assertion ? "pass" : "fail";
      const message = `Expected '${resolvedExpectVal}' to${
        negated ? " not" : ""
      } be type '${expectedType}'`;

      currTestStack[currTestStack.length - 1].expectResults.push({
        status,
        message,
      });
    } else {
      const message =
        'Argument for toBeType should be "string", "boolean", "number", "object", "undefined", "bigint", "symbol" or "function"';
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
    }

    return undefined;
  };

  const toHaveLengthFn = (expectedLength: any) => {
    if (
      !(
        Array.isArray(resolvedExpectVal) ||
        typeof resolvedExpectVal === "string"
      )
    ) {
      const message =
        "Expected toHaveLength to be called for an array or string";
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });

      return undefined;
    }

    if (typeof expectedLength === "number" && !Number.isNaN(expectedLength)) {
      let assertion = resolvedExpectVal.length === expectedLength;

      if (negated) {
        assertion = !assertion;
      }

      const status = assertion ? "pass" : "fail";
      const message = `Expected the array to${
        negated ? " not" : ""
      } be of length '${expectedLength}'`;

      currTestStack[currTestStack.length - 1].expectResults.push({
        status,
        message,
      });
    } else {
      const message = "Argument for toHaveLength should be a number";
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
    }

    return undefined;
  };

  const toIncludeFn = (needle: any) => {
    if (
      !(
        Array.isArray(resolvedExpectVal) ||
        typeof resolvedExpectVal === "string"
      )
    ) {
      const message = "Expected toInclude to be called for an array or string";
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
      return undefined;
    }

    if (needle === null) {
      const message = "Argument for toInclude should not be null";
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
      return undefined;
    }

    if (needle === undefined) {
      const message = "Argument for toInclude should not be undefined";
      currTestStack[currTestStack.length - 1].expectResults.push({
        status: "error",
        message,
      });
      return undefined;
    }

    let assertion = resolvedExpectVal.includes(needle);

    if (negated) {
      assertion = !assertion;
    }

    const expectValPretty = JSON.stringify(resolvedExpectVal);
    const needlePretty = JSON.stringify(needle);
    const status = assertion ? "pass" : "fail";
    const message = `Expected ${expectValPretty} to${
      negated ? " not" : ""
    } include ${needlePretty}`;

    currTestStack[currTestStack.length - 1].expectResults.push({
      status,
      message,
    });
    return undefined;
  };

  result.toBe = toBeFn;
  result.toBeLevel2xx = toBeLevel2xxFn;
  result.toBeLevel3xx = toBeLevel3xxFn;
  result.toBeLevel4xx = toBeLevel4xxFn;
  result.toBeLevel5xx = toBeLevel5xxFn;
  result.toBeType = toBeTypeFn;
  result.toHaveLength = toHaveLengthFn;
  result.toInclude = toIncludeFn;

  Object.defineProperties(result, {
    not: {
      get: () => createExpectation(expectVal, !negated, currTestStack),
    },
  });

  return result;
};

/**
 * Compiles methods for use under the `voiden-wrapper` namespace for pre request scripts
 * @param envs The current state of the environment variables
 * @returns Object with methods in the `voiden-wrapper` namespace
 */
export const getPreRequestScriptMethods = (envs: TestResult["envs"]) => {
  const { methods, updatedEnvs } = getSharedMethods(structuredClone(envs));
  return { voiden: methods, updatedEnvs };
};

/**
 * Compiles methods for use under the `voiden-wrapper` namespace for post request scripts
 * @param envs The current state of the environment variables
 * @returns Object with methods in the `voiden-wrapper` namespace and test run stack
 */
export const getTestRunnerScriptMethods = (envs: TestResult["envs"]) => {
  const testRunStack: TestDescriptor[] = [
    { descriptor: "root", expectResults: [], children: [] },
  ];

  const testFn = (descriptor: string, testFunc: () => void) => {
    testRunStack.push({
      descriptor,
      expectResults: [],
      children: [],
    });

    testFunc();

    const child = testRunStack.pop() as TestDescriptor;
    testRunStack[testRunStack.length - 1].children.push(child);
  };

  const expectFn = (expectVal: any) =>
    createExpectation(expectVal, false, testRunStack);

  const { methods, updatedEnvs } = getSharedMethods(structuredClone(envs));

  const voiden = {
    ...methods,
    expect: expectFn,
    test: testFn,
  };

  return { voiden, testRunStack, updatedEnvs };
};
