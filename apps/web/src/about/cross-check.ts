/**
 * Gemma 4's second oracle (04 §8): the Gemma 3 SentencePiece model agrees with the HF tokenizer.json on all but the
 * literal special-token cases. Copied from fixtures/google-gemma4.json › crossCheck (About must not load the 1.7 MB
 * fixture); About.test.ts keeps it equal to the fixture.
 */
export const GEMMA4_CROSS_CHECK = {
  library: 'sentencepiece',
  version: '0.2.2',
  agreed: 372,
  total: 374,
  disagreements: [
    {
      name: 'special-start-of-turn',
      explanation:
        "'<start_of_turn>' is USER_DEFINED piece 105 in the Gemma 3 model, which SentencePiece always matches as one atomic token; Gemma 4 renamed id 105 to '<|turn>' and has no '<start_of_turn>' entry, so HF tokenizers BPE-encodes the string as ordinary text.",
    },
    {
      name: 'special-gemma2-end-of-turn',
      explanation:
        "'<end_of_turn>' is USER_DEFINED piece 106 in the Gemma 3 model, which SentencePiece always matches as one atomic token; Gemma 4 renamed id 106 to '<turn|>' and has no '<end_of_turn>' entry, so HF tokenizers BPE-encodes the string as ordinary text.",
    },
  ],
} as const;
