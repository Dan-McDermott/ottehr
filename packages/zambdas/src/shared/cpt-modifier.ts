import { Extension, Procedure } from 'fhir/r4b';
import { CODE_SYSTEM_CPT, CODE_SYSTEM_CPT_MODIFIER, EXTENSION_URL_CPT_MODIFIER } from 'utils/lib/helpers/rcm';

export const makeCptModifierExtension = (input: { code: string; display: string }[]): Extension => {
  return {
    url: EXTENSION_URL_CPT_MODIFIER,
    valueCodeableConcept: {
      coding: input.map((cptCodeInfo) => ({
        system: CODE_SYSTEM_CPT_MODIFIER,
        code: cptCodeInfo.code,
        display: cptCodeInfo.display,
      })),
    },
  };
};

export const getCptModifierCodeFromProcedure = (
  fhirProcedure: Procedure
): { code: string; display: string }[] | undefined => {
  const coding = fhirProcedure.code?.coding?.find((c) => c.system === CODE_SYSTEM_CPT);
  if (!coding) return;

  const modifierCodableConcept = coding?.extension?.find(
    (ext) => ext.url === EXTENSION_URL_CPT_MODIFIER && ext.valueCodeableConcept
  )?.valueCodeableConcept;
  const modifier = modifierCodableConcept?.coding?.flatMap((c) =>
    c.system === CODE_SYSTEM_CPT_MODIFIER && c.code ? [{ code: c.code, display: c.display ?? '' }] : []
  );

  return modifier;
};
