import zipfile
import os
import numpy as np
from tensorflow.keras import layers, models
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from PIL import Image
from io import BytesIO

# Step 1: ตั้งค่าโฟลเดอร์และไฟล์ ZIP
nude_zip_path = "data/nude.zip"
non_nude_zip_path = "data/non_nude.zip"

# Step 2: ฟังก์ชันดึงภาพจากไฟล์ ZIP
def extract_images_from_zip(zip_path, label):
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        file_list = zip_ref.namelist()
        images = []
        labels = []
        for file in file_list:
            if file.endswith(('.png', '.jpg', '.jpeg')):  # เฉพาะไฟล์ภาพ
                with zip_ref.open(file) as image_file:
                    img = Image.open(BytesIO(image_file.read())).resize((128, 128))  # Resize เป็น 128x128
                    img = img.convert("RGB")  # แปลงเป็น RGB
                    images.append(np.array(img, dtype=np.float32) / 255.0)  # Normalize
                    labels.append(label)
        return images, labels

# Step 3: ดึงข้อมูลจากไฟล์ ZIP
nude_images, nude_labels = extract_images_from_zip(nude_zip_path, label=1)  # nude = 1
non_nude_images, non_nude_labels = extract_images_from_zip(non_nude_zip_path, label=0)  # non_nude = 0

# Step 4: รวมข้อมูลและสร้าง Dataset
images = np.stack(nude_images + non_nude_images, axis=0)
labels = np.array(nude_labels + non_nude_labels)

# แบ่งข้อมูล Train และ Validation
x_train, x_val, y_train, y_val = train_test_split(images, labels, test_size=0.2, random_state=42)

# Step 5: สร้างโมเดล CNN
model = models.Sequential([
    layers.Conv2D(16, (3, 3), activation='relu', input_shape=(128, 128, 3)),
    layers.MaxPooling2D((2, 2)),

    layers.Conv2D(32, (3, 3), activation='relu'),
    layers.MaxPooling2D((2, 2)),

    layers.Conv2D(64, (3, 3), activation='relu'),
    layers.MaxPooling2D((2, 2)),

    layers.Flatten(),
    layers.Dense(128, activation='relu'),
    layers.Dropout(0.5),
    layers.Dense(1, activation='sigmoid')  # Binary classification
])

# Step 6: คอมไพล์โมเดล
model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])

# Step 7: เทรนโมเดล
history = model.fit(
    x_train, y_train,
    validation_data=(x_val, y_val),
    epochs=20,  # ลดจำนวน Epoch เพื่อประหยัดเวลา
    batch_size=32,
    verbose=1
)

# Step 8: บันทึกโมเดล
model.save('nude_classifier_model.h5')
print("\nModel saved as 'nude_classifier_model.h5'")

# Step 9: ประเมินโมเดลบน Validation Set
val_loss, val_accuracy = model.evaluate(x_val, y_val, verbose=1)
print(f"\nValidation Accuracy: {val_accuracy * 100:.2f}%")

# แสดงผล Classification Report และ Confusion Matrix
y_pred = (model.predict(x_val) > 0.5).astype("int32")
print("\nClassification Report:")
print(classification_report(y_val, y_pred, target_names=['non_nude', 'nude']))

print("\nConfusion Matrix:")
print(confusion_matrix(y_val, y_pred))
