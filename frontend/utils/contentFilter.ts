// Bad words in English and Tagalog
const BAD_WORDS = new Set([
  // English profanity
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'asshole', 'bitch', 'bastard', 
  'damn', 'dammit', 'hell', 'crap', 'dick', 'pussy', 'cunt', 'whore', 'slut',
  'cock', 'cum', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'idiot',
  
  // Tagalog profanity
  'putangina', 'puta', 'gago', 'gaga', 'tanga', 'tangina', 'pakshet', 'pesteng',
  'yawa', 'buang', 'ulol', 'lintik', 'punyeta', 'hinayupak', 'kupal', 'tarantado',
  'bobo', 'bobo', 'tangina', 'putang', 'shit', 'fuck',
  
  // Common variations and misspellings
  'f*ck', 'fck', 'fuk', 'sh1t', 'a$$', 'b1tch', 'p@kshet', 'put@ng',
  'g@g0', 't@nga', 'k@pal', 'b0b0', 'l1ntik',
  
  // Mild but inappropriate words
  'sex', 'seks', 'penis', 'vagina', 'condom', 'kantot', 'kiki', 'titi',
]);

function normalizeText(text: string): string {
  if (!text) return '';
  
  // Convert to lowercase
  let normalized = text.toLowerCase();
  
  // Replace common character substitutions using string replace (not regex)
  normalized = normalized.replace(/[@]/g, 'a');
  normalized = normalized.replace(/[0]/g, 'o');
  normalized = normalized.replace(/[1]/g, 'i');
  normalized = normalized.replace(/[3]/g, 'e');
  normalized = normalized.replace(/[4]/g, 'a');
  normalized = normalized.replace(/[5]/g, 's');
  normalized = normalized.replace(/[7]/g, 't');
  normalized = normalized.replace(/[$]/g, 's');
  normalized = normalized.replace(/[!]/g, 'i');
  normalized = normalized.replace(/[*]/g, '');
  
  // Remove extra whitespace and punctuation
  normalized = normalized.replace(/[^\w\s]/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

export function containsBadWords(text: string): boolean {
  if (!text) return false;
  
  const normalizedText = normalizeText(text);
  const words = normalizedText.split(' ');
  
  for (const word of words) {
    if (BAD_WORDS.has(word)) {
      return true;
    }
    
    // Check for partial matches (for words that might be combined)
    for (const badWord of BAD_WORDS) {
      if (word.includes(badWord)) {
        return true;
      }
    }
  }
  
  return false;
}

export function getDetectedBadWords(text: string): string[] {
  if (!text) return [];
  
  const normalizedText = normalizeText(text);
  const words = normalizedText.split(' ');
  const detectedWords = new Set<string>();
  
  for (const word of words) {
    if (BAD_WORDS.has(word)) {
      detectedWords.add(word);
    } else {
      // Check for partial matches
      for (const badWord of BAD_WORDS) {
        if (word.includes(badWord)) {
          detectedWords.add(badWord);
          break;
        }
      }
    }
  }
  
  return Array.from(detectedWords);
}

export function filterContent(text: string): {
  isClean: boolean;
  hasBadWords: boolean;
  detectedWords: string[];
  wordCount: number;
} {
  const hasBadWords = containsBadWords(text);
  const detectedWords = getDetectedBadWords(text);
  
  return {
    isClean: !hasBadWords,
    hasBadWords,
    detectedWords,
    wordCount: detectedWords.length
  };
}
