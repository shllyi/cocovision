import re
from typing import List, Set

# Bad words in English and Tagalog
BAD_WORDS = {
    # English profanity
    'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'asshole', 'bitch', 'bastard', 
    'damn', 'dammit', 'hell', 'crap', 'dick', 'pussy', 'cunt', 'whore', 'slut',
    'cock', 'cum', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'idiot',
    
    # Tagalog profanity
    'putangina', 'puta', 'gago', 'gaga', 'tanga', 'tangina', 'pakshet', 'pesteng',
    'yawa', 'buang', 'ulol', 'lintik', 'punyeta', 'hinayupak', 'kupal', 'tarantado',
    'bobo', 'bobo', 'tangina', 'putang', 'shit', 'fuck',
    
    # Common variations and misspellings
    'f*ck', 'fck', 'fuk', 'sh1t', 'a$$', 'b1tch', 'p@kshet', 'put@ng',
    'g@g0', 't@nga', 'k@pal', 'b0b0', 'l1ntik',
    
    # Mild but inappropriate words
    'sex', 'seks', 'penis', 'vagina', 'condom', 'kantot', 'kiki', 'titi',
}

def normalize_text(text: str) -> str:
    """
    Normalize text by converting to lowercase and removing common character substitutions.
    """
    # Convert to lowercase
    text = text.lower()
    
    # Replace common character substitutions
    replacements = {
        '@': 'a',
        '0': 'o',
        '1': 'i', 
        '3': 'e',
        '4': 'a',
        '5': 's',
        '7': 't',
        '$': 's',
        '!': 'i',
        '*': '',
    }
    
    for old, new in replacements.items():
        text = text.replace(old, new)
    
    # Remove extra whitespace and punctuation
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

def contains_bad_words(text: str) -> bool:
    """
    Check if the given text contains any bad words.
    Returns True if bad words are found, False otherwise.
    """
    if not text:
        return False
    
    # Normalize the text for checking
    normalized_text = normalize_text(text)
    
    # Split into words and check each one
    words = normalized_text.split()
    
    for word in words:
        if word in BAD_WORDS:
            return True
        
        # Check for partial matches (for words that might be combined)
        for bad_word in BAD_WORDS:
            if bad_word in word:
                return True
    
    return False

def get_detected_bad_words(text: str) -> List[str]:
    """
    Return a list of bad words found in the text.
    """
    if not text:
        return []
    
    normalized_text = normalize_text(text)
    words = normalized_text.split()
    detected_words = []
    
    for word in words:
        if word in BAD_WORDS:
            detected_words.append(word)
        else:
            # Check for partial matches
            for bad_word in BAD_WORDS:
                if bad_word in word:
                    detected_words.append(bad_word)
                    break
    
    return list(set(detected_words))  # Remove duplicates

def filter_content(text: str) -> dict:
    """
    Main filtering function that returns a dictionary with filtering results.
    """
    has_bad_words = contains_bad_words(text)
    detected_words = get_detected_bad_words(text) if has_bad_words else []
    
    return {
        'is_clean': not has_bad_words,
        'has_bad_words': has_bad_words,
        'detected_words': detected_words,
        'word_count': len(detected_words)
    }
