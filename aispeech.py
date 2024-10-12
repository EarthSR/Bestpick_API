from transformers import TFBertForSequenceClassification, BertTokenizer
from tensorflow.keras.optimizers import Adam
from sklearn.model_selection import train_test_split
import pandas as pd
import tensorflow as tf

# โหลดโมเดลและ tokenizer
model_name = "bert-base-multilingual-cased"
tokenizer = BertTokenizer.from_pretrained(model_name)
bert_model = TFBertForSequenceClassification.from_pretrained(model_name, num_labels=4)

# การเตรียมข้อมูล
def encode_data(texts, tokenizer, max_len=128):
    return tokenizer(
        texts.tolist(),
        padding=True,
        truncation=True,
        max_length=max_len,
        return_tensors='tf'
    )

data = pd.read_csv("thai_balanced_toxic_comments.csv")
texts = data['Text'].values
labels = data['Label'].values

# แบ่งข้อมูลเป็นชุดฝึกและทดสอบ
X_train, X_test, y_train, y_test = train_test_split(texts, labels, test_size=0.2, random_state=42)

# เข้ารหัสข้อความ
train_encodings = encode_data(X_train, tokenizer)
test_encodings = encode_data(X_test, tokenizer)

# การฝึกโมเดล BERT
bert_model.compile(optimizer=tf.optimizers.Adam(learning_rate=3e-5), loss='sparse_categorical_crossentropy', metrics=['accuracy'])

bert_model.fit(
    [train_encodings['input_ids'], train_encodings['attention_mask']],
    y_train,
    epochs=3,
    batch_size=16,
    validation_data=([test_encodings['input_ids'], test_encodings['attention_mask']], y_test)
)

# การประเมินผลโมเดล
loss, accuracy = bert_model.evaluate([test_encodings['input_ids'], test_encodings['attention_mask']], y_test)
print(f'Test Accuracy: {accuracy}')
