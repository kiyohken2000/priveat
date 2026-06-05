// Mifflin-St Jeor 式（1990, 現在最も標準的に使われる基礎代謝推定式）。
//   男性: 10×kg + 6.25×cm − 5×age + 5
//   女性: 10×kg + 6.25×cm − 5×age − 161
// 必要パラメータが欠けていたら null を返す（呼び出し側で「未設定」表示）。

export const computeBmr = ({ weightKg, heightCm, age, sex } = {}) => {
  if (
    weightKg == null ||
    heightCm == null ||
    age == null ||
    (sex !== 'male' && sex !== 'female')
  ) {
    return null
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}
