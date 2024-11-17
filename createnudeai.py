import os
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras import layers, models
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from sklearn.metrics import classification_report, confusion_matrix

# Step 1: ตั้งค่าโครงสร้างข้อมูล
main_dir = "data"  # ชี้ไปยังโฟลเดอร์หลักที่มี 'nude' และ 'non_nude'

# ตรวจสอบโฟลเดอร์
if not os.path.exists(main_dir):
    raise FileNotFoundError(f"โฟลเดอร์ '{main_dir}' ไม่พบ กรุณาตรวจสอบ path ของข้อมูล")

# Step 2: เตรียมข้อมูลรูปภาพพร้อม Data Augmentation
train_datagen = ImageDataGenerator(
    rescale=1./255,
    rotation_range=40,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    horizontal_flip=True,
    validation_split=0.2  # แบ่งข้อมูล 20% สำหรับ validation
)

train_generator = train_datagen.flow_from_directory(
    main_dir,
    target_size=(150, 150),
    batch_size=32,
    class_mode='binary',
    subset='training'
)

validation_generator = train_datagen.flow_from_directory(
    main_dir,
    target_size=(150, 150),
    batch_size=32,
    class_mode='binary',
    subset='validation'
)

# Step 3: สร้างโมเดล CNN พร้อม Dropout และ Batch Normalization
model = models.Sequential([
    layers.Conv2D(32, (3, 3), activation='relu', input_shape=(150, 150, 3)),
    layers.BatchNormalization(),
    layers.MaxPooling2D((2, 2)),
    
    layers.Conv2D(64, (3, 3), activation='relu'),
    layers.BatchNormalization(),
    layers.MaxPooling2D((2, 2)),
    
    layers.Conv2D(128, (3, 3), activation='relu'),
    layers.BatchNormalization(),
    layers.MaxPooling2D((2, 2)),
    
    layers.Flatten(),
    layers.Dense(256, activation='relu'),
    layers.Dropout(0.5),
    layers.Dense(1, activation='sigmoid')  # ใช้ sigmoid สำหรับ binary classification
])

# Step 4: คอมไพล์โมเดล
model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])

# Step 5: ใช้ Callbacks สำหรับปรับการเรียนรู้
early_stopping = EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True)
reduce_lr = ReduceLROnPlateau(monitor='val_loss', factor=0.2, patience=3, min_lr=0.00001)

# คำนวณจำนวน steps ต่อ epoch
steps_per_epoch = train_generator.samples // train_generator.batch_size
validation_steps = validation_generator.samples // validation_generator.batch_size

# Step 6: เทรนโมเดล
history = model.fit(
    train_generator,
    steps_per_epoch=steps_per_epoch,
    epochs=30,
    validation_data=validation_generator,
    validation_steps=validation_steps,
    callbacks=[early_stopping, reduce_lr]
)

# Step 7: บันทึกโมเดล
model.save('nude_classifier_model.h5')
print("Model saved as 'nude_classifier_model.h5'")

# Step 8: ทดสอบโมเดลบน Validation Set
validation_generator.reset()
y_true = validation_generator.classes
y_pred = (model.predict(validation_generator) > 0.5).astype("int32")

# แสดงผล Classification Report
print("\nClassification Report:")
print(classification_report(y_true, y_pred, target_names=['non_nude', 'nude']))

# แสดงผล Confusion Matrix
print("\nConfusion Matrix:")
print(confusion_matrix(y_true, y_pred))
