import pickle
from pythainlp import word_tokenize

# โหลดโมเดลตรวจสอบคำหยาบ
with open('profanity_model.pkl', 'rb') as model_file:
    model_profanity, vectorizer_profanity = pickle.load(model_file)

def censor_profanity(text):
    """
    เซ็นเซอร์คำหยาบในข้อความ
    """
    try:
        # แบ่งคำด้วย PyThaiNLP
        words = word_tokenize(text, engine="newmm")
        
        # เซ็นเซอร์คำที่เป็นคำหยาบ
        censored_words = [
            '*' * len(word) if model_profanity.predict(vectorizer_profanity.transform([word]))[0] == 1 else word
            for word in words
        ]
        
        return ''.join(censored_words)
    except Exception as e:
        print(f"Error in censor_profanity: {e}")
        return text
