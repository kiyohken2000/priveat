import React from 'react'
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../theme'
import { resolveOcrImageUri } from '../utils/persistImage'

// 永続化済み OCR 画像をフルスクリーン表示するモーダル。
//   imageUri が null/undefined の場合は「画像なし」プレースホルダ。
export default function ImagePreviewModal({ visible, imageUri, title, onClose }) {
  const resolved = resolveOcrImageUri(imageUri)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.frame} pointerEvents="box-none">
          <View style={styles.header} pointerEvents="box-none">
            {title ? <Text style={styles.title}>{title}</Text> : <View />}
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <FontIcon name="times" size={20} color={colors.white} />
            </Pressable>
          </View>
          {resolved ? (
            <Image source={{ uri: resolved }} style={styles.image} resizeMode="contain" />
          ) : (
            <View style={styles.empty}>
              <FontIcon name="image" size={40} color="#888" />
              <Text style={styles.emptyText}>画像が保存されていません</Text>
              <Text style={styles.emptyHint}>
                v2 マイグレーション前に登録された OCR 入力には画像が残っていません。
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
  },
  frame: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: colors.white,
    fontSize: fontSize.large,
    fontWeight: '600',
    flex: 1,
  },
  closeBtn: { padding: 4 },
  image: {
    flex: 1,
    width: '100%',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    color: colors.white,
    fontSize: fontSize.middle,
    marginTop: 12,
    fontWeight: '600',
  },
  emptyHint: {
    color: '#bbb',
    fontSize: fontSize.small,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
})
