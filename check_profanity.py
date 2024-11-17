import pickle
import sys
from pythainlp import word_tokenize

# โหลดโมเดลสำหรับตรวจสอบคำหยาบ
with open('profanity_model.pkl', 'rb') as model_file:
    model_profanity, vectorizer_profanity = pickle.load(model_file)

def censor_profanity(sentence):
    words = word_tokenize(sentence, engine="newmm")
    censored_words = [
        '*' * len(word) if model_profanity.predict(vectorizer_profanity.transform([word]))[0] == 1 else word
        for word in words
    ]
    return ''.join(censored_words)

if __name__ == '__main__':
    # รับข้อความจาก argument
    text = sys.argv[1]
    censored_text = censor_profanity(text)
    print(censored_text)
