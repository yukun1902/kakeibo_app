// ============================================================
// おかねノート（家計簿アプリ）の REST API サーバー
// ============================================================
//
// 【このプログラムがやること】
//   ブラウザ（画面）から「支出を追加して」「一覧をちょうだい」といったお願い（リクエスト）を受け取り、
//   PostgreSQL（データベース）を読み書きして、結果を JSON という形で返す（レスポンス）。
//
//     ブラウザ ──リクエスト──▶ このプログラム ──SQL──▶ PostgreSQL
//     ブラウザ ◀──JSON───── このプログラム ◀──結果── PostgreSQL
//
// 【ファイルの中身の順番】
//   1. 共通の部品      … JSON を返す・読む、ID を取り出す などの小さな関数
//   2. 会員登録・ログイン … パスワードのハッシュ化、JWT（ログインの証明書）の発行と確認
//   3. カテゴリーの API
//   4. 支出の API
//   5. 集計の API
//   6. main 関数        … プログラムのスタート地点。設定を読み込み、URL と処理を結びつけて、サーバーを起動する
//
// 【読み方のコツ】
//   いちばん下の main 関数から読むと全体がつかみやすい。
//   「どの URL が来たら、どの関数を呼ぶか」が一覧になっているので、気になる関数を上から探して読む。
//
// 詳しい解説は docs/解説.md を見てください。

package main

// 使うパッケージ（道具）を読み込む
import (
	"context"       // リクエストにログイン中の会員IDを持たせるための道具
	"database/sql"  // データベースを操作するための道具
	"encoding/json" // JSONを読み書きするための道具
	"errors"        // エラーの種類を調べるための道具
	"fmt"           // 文字を出力するための道具
	"log"           // ログ（記録）を出すための道具
	"net/http"      // Webサーバーを作るための道具
	"net/mail"      // メールアドレスの形をチェックするための道具
	"net/url"       // URLの ?from=... の部分を扱うための道具
	"os"            // 環境変数を読むための道具
	"strconv"       // 文字列を数値に変換するための道具
	"strings"       // 文字列を区切ったり空白を取ったりするための道具
	"time"          // 日付の形式をチェックするための道具
	"unicode/utf8"  // 文字数を数えるための道具

	"github.com/golang-jwt/jwt/v5" // JWT（ログインの証明書）を作る・確かめるための道具
	"github.com/joho/godotenv"     // .env ファイルを読み込むための道具
	"github.com/lib/pq"            // PostgreSQL ドライバ（エラーの種類を調べるのにも使う）
	"golang.org/x/crypto/bcrypt"   // パスワードをハッシュ化するための道具
)

// ============================================================
// 1. 共通の部品
// ============================================================

// db はアプリ全体で使うデータベース接続
// main 関数で1回だけ接続し、どの関数からでも db.Query(...) のように使えるよう、関数の外に置いている
var db *sql.DB

// writeJSON はデータをJSONにして返す
//
// 【w と status とは】
//
//	w（http.ResponseWriter）… ブラウザへの「返事」を書き込む場所。ここに書いた内容がブラウザに届く
//	status … 結果を表す番号（HTTPステータスコード）。よく使うもの:
//	  200 OK（成功） / 201 Created（追加できた） / 204 No Content（成功・返す中身なし）
//	  400 Bad Request（送られてきた内容がおかしい） / 401 Unauthorized（ログインが必要）
//	  404 Not Found（見つからない） / 409 Conflict（他のデータとぶつかる） / 500（サーバー側のエラー）
//	data … 返したいデータ。Go の構造体やスライスを渡すと、自動で JSON の文字に変換される
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeError はエラーメッセージをJSONで返す
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// readJSON はリクエストのJSONを dst に読み込む。失敗したらエラーを返して false になる
//
// 【r とは】
//
//	r（*http.Request）… ブラウザから届いた「お願い」の中身。URL・ヘッダー・本文（Body）などが入っている
//	POST や PUT では、本文に {"name": "食費"} のような JSON が入って送られてくる
//
// 【使い方】
//
//	var input struct { Name string `json:"name"` }
//	if !readJSON(w, r, &input) { return }   // ← 失敗したらエラーは返し済みなので、そのまま終わる
//	JSON の "name" の値が input.Name に入る（`json:"name"` が「JSON ではこの名前」という目印）
func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	// 大きすぎるデータは受け付けない（1MBまで）
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "リクエストの形式が正しくありません")
		return false
	}
	return true
}

// pathID は URL の {id} の部分を数値にして取り出す。正しくなければエラーを返して false になる
func pathID(w http.ResponseWriter, r *http.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "IDが正しくありません")
		return 0, false
	}
	return id, true
}

// isValidDate は "2026-10-05" の形の正しい日付かどうかを調べる
func isValidDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// hasPQCode は PostgreSQL のエラーが指定したコードかどうかを調べる
// 例: 23503 = 外部キー違反
func hasPQCode(err error, code string) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && string(pqErr.Code) == code
}

// ============================================================
// 2. 会員登録・ログイン（JWT）
// ============================================================
//
// 【ログインのしくみ（ざっくり）】
//   1. 会員登録：メールアドレスと「ハッシュ化したパスワード」を users テーブルに保存する
//   2. ログイン：送られてきたパスワードと保存してあるハッシュを照合し、合っていれば JWT を渡す
//   3. それ以降：ブラウザは毎回 JWT を付けてリクエストする。サーバーは JWT が本物か確かめてから処理する
//
// 【ハッシュ化とは】
//   パスワードを、元に戻せない別の文字列に変換すること。"password123" → "$2a$10$Xk3...（60文字）"
//   もしデータベースの中身が盗まれても、元のパスワードはわからない。
//   照合するときは、送られてきたパスワードを同じ方法で変換して、保存してあるものと比べる。
//
// 【JWT（ジェイダブリューティー）とは】
//   「この人は会員ID 1 番で、10月16日まで有効」という内容に、サーバーだけが知っている鍵（JWT_SECRET）で
//   署名を付けた文字列。"xxxxx.yyyyy.zzzzz" のように点で区切られた3つの部分（種類.中身.署名）でできている。
//   中身を書き換えると署名が合わなくなるので、偽物はすぐわかる。
//   サーバーは「誰がログイン中か」を覚えておく必要がなく、JWT を見るだけで判断できる。

// jwtSecret は JWT の署名に使う鍵（.env の JWT_SECRET から読み込む）
var jwtSecret []byte

// tokenLifetime はログインしてから JWT が使える時間
const tokenLifetime = 24 * time.Hour

// dummyHash は、登録されていないメールアドレスでログインされたときにも
// パスワードの照合と同じだけ時間をかけるためのハッシュ
// （応答の速さから「そのメールアドレスが登録済みか」を推測されにくくする）
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost)

// User は users テーブルの1行を表す（パスワードのハッシュは外に出さない）
type User struct {
	ID        int    `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"` // "2026-10-05T14:35:00" の形
}

// userColumns は User を読み出すときに使う列
const userColumns = `id, email, COALESCE(to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), '')`

// credentials は会員登録・ログインのときに受け取るデータ
type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// readCredentials はリクエストからメールアドレスとパスワードを読み込む
// メールアドレスは大文字・小文字の違いで別人にならないよう、小文字にそろえる
func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var c credentials
	if !readJSON(w, r, &c) {
		return c, false
	}
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if c.Email == "" || c.Password == "" {
		writeError(w, http.StatusBadRequest, "email と password は必須です")
		return c, false
	}
	return c, true
}

// register は POST /api/register : 会員登録する
// リクエスト例: {"email": "taro@example.com", "password": "password123"}
func register(w http.ResponseWriter, r *http.Request) {
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}
	// 正しいメールアドレスの形か調べる（"名前 <taro@example.com>" のような形は受け付けない）
	addr, err := mail.ParseAddress(c.Email)
	if err != nil || addr.Address != c.Email || len(c.Email) > 255 {
		writeError(w, http.StatusBadRequest, "email の形が正しくありません")
		return
	}
	// bcrypt は72バイトまでしか扱えないので、それより長いパスワードは受け付けない
	if utf8.RuneCountInString(c.Password) < 8 || len(c.Password) > 72 {
		writeError(w, http.StatusBadRequest, "password は8文字以上・72バイト以内で指定してください")
		return
	}

	// パスワードはそのまま保存せず、bcrypt でハッシュ化してから保存する
	// bcrypt は毎回ランダムな値（ソルト）を混ぜるので、同じパスワードでも毎回ちがうハッシュになる
	// DefaultCost は「どれくらい時間をかけて計算するか」。わざと遅くして、総当たりで破られにくくしている
	hash, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Println("ハッシュ化エラー:", err)
		writeError(w, http.StatusInternalServerError, "会員登録に失敗しました")
		return
	}

	var u User
	err = db.QueryRow(
		"INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING "+userColumns,
		c.Email, string(hash),
	).Scan(&u.ID, &u.Email, &u.CreatedAt)
	if err != nil {
		// 23505 = 一意制約違反（同じメールアドレスがすでに登録されている）
		if hasPQCode(err, "23505") {
			writeError(w, http.StatusConflict, "このメールアドレスはすでに登録されています")
			return
		}
		log.Println("会員登録エラー:", err)
		writeError(w, http.StatusInternalServerError, "会員登録に失敗しました")
		return
	}

	writeJSON(w, http.StatusCreated, u)
}

// login は POST /api/login : ログインして JWT を返す
// リクエスト例: {"email": "taro@example.com", "password": "password123"}
// 以降は、返ってきた token を Authorization: Bearer <token> の形で付けて API を呼ぶ
func login(w http.ResponseWriter, r *http.Request) {
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}

	// メールアドレスかパスワードのどちらが違うかは教えない（同じメッセージにする）
	const failMessage = "メールアドレスまたはパスワードが違います"

	var userID int
	var hash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE email = $1", c.Email).Scan(&userID, &hash)
	if err == sql.ErrNoRows {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(c.Password))
		writeError(w, http.StatusUnauthorized, failMessage)
		return
	}
	if err != nil {
		log.Println("ログインエラー:", err)
		writeError(w, http.StatusInternalServerError, "ログインに失敗しました")
		return
	}
	// 送られてきたパスワードと、保存してあるハッシュが合っているか確かめる
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(c.Password)) != nil {
		writeError(w, http.StatusUnauthorized, failMessage)
		return
	}

	// JWT を作る：中身は「誰か（会員ID）」と「いつまで使えるか」
	//   Subject   … 誰のトークンか（会員IDを文字にしたもの）
	//   IssuedAt  … いつ発行したか
	//   ExpiresAt … いつまで使えるか（今から24時間後）
	// HS256 は「鍵（jwtSecret）を使って署名する方式」の名前
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   strconv.Itoa(userID),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(tokenLifetime)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
	if err != nil {
		log.Println("JWT作成エラー:", err)
		writeError(w, http.StatusInternalServerError, "ログインに失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"token_type": "Bearer",
		"expires_in": int(tokenLifetime.Seconds()), // 有効期間（秒）
	})
}

// contextKey はリクエストに値を持たせるときの名前に使う型
type contextKey string

const userIDKey contextKey = "userID"

// requireAuth はログインしているか（正しい JWT が付いているか）を確かめてから、次の処理を呼ぶ
// ログインしていなければ 401 を返して、次の処理は呼ばない
//
// 【このような関数を「ミドルウェア」と呼ぶ】
//
//	本来の処理（例: getExpenses）の手前に立つ「門番」のようなもの。
//	main 関数で requireAuth(getExpenses) のように包むと、
//	  リクエスト → requireAuth（JWT をチェック）→ OK なら getExpenses
//	の順に動く。チェックを1か所にまとめられるので、各処理にログイン確認を書かなくて済む。
//
// 【関数を受け取って、関数を返す】
//
//	引数 next は「チェックが通ったら呼ぶ本来の処理」。
//	return func(w, r) {...} で「チェック付きの新しい処理」を作って返している。
func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		unauthorized := func(message string) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeError(w, http.StatusUnauthorized, message)
		}

		// Authorization: Bearer <JWT> の形で送られてくる
		tokenString, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || tokenString == "" {
			unauthorized("ログインが必要です")
			return
		}

		// 署名が正しいか・期限が切れていないかを確かめる
		// （HS256 以外の方式で作られたトークンは受け付けない）
		claims := &jwt.RegisteredClaims{}
		_, err := jwt.ParseWithClaims(tokenString, claims,
			func(t *jwt.Token) (any, error) { return jwtSecret, nil },
			jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
			jwt.WithExpirationRequired(),
		)
		if err != nil {
			unauthorized("ログインの有効期限が切れているか、トークンが正しくありません")
			return
		}
		userID, err := strconv.Atoi(claims.Subject)
		if err != nil || userID <= 0 {
			unauthorized("トークンが正しくありません")
			return
		}

		// ログイン中の会員IDをリクエストに持たせて、次の処理を呼ぶ
		// （context はリクエストに「おまけの情報」を付けて運ぶしくみ。
		//   次の処理では currentUserID(r) で取り出せる）
		next(w, r.WithContext(context.WithValue(r.Context(), userIDKey, userID)))
	}
}

// currentUserID はログイン中の会員IDを取り出す（requireAuth を通った処理の中で使う）
func currentUserID(r *http.Request) int {
	id, _ := r.Context().Value(userIDKey).(int)
	return id
}

// getMe は GET /api/me : ログイン中の会員の情報を返す
func getMe(w http.ResponseWriter, r *http.Request) {
	var u User
	err := db.QueryRow("SELECT "+userColumns+" FROM users WHERE id = $1", currentUserID(r)).
		Scan(&u.ID, &u.Email, &u.CreatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusUnauthorized, "会員が見つかりません")
		return
	}
	if err != nil {
		log.Println("会員情報の取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "会員情報の取得に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, u)
}

// ============================================================
// 3. カテゴリーのAPI
// ============================================================
//
// このあとの API はどれも同じ流れで書いてある。1つ読めば、ほかも読める。
//   1. リクエストから値を取り出す（URL の {id}、本文の JSON など）
//   2. 値をチェックする（空でないか、形が正しいか）→ ダメなら 400 を返して終わり
//   3. SQL を実行する
//   4. 結果を JSON で返す（失敗したら、理由に合ったステータスコードで返す）

// Category は categories テーブルの1行を表す
//
// 【構造体（struct）とは】
//
//	いくつかの値をひとまとめにした「型」。ここでは「ID と名前を持つカテゴリー」を表している。
//	`json:"id"` は「JSON にするときは id という名前にする」という目印（タグ）。
//	これがあるので writeJSON に渡すと {"id": 1, "name": "食費"} という JSON になる。
type Category struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// readCategoryName はリクエストからカテゴリー名を読み込んでチェックする
// exceptID には、同じ名前があるか調べるときに除外するID（更新のとき自分自身）を渡す
func readCategoryName(w http.ResponseWriter, r *http.Request, exceptID int) (string, bool) {
	var input struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &input) {
		return "", false
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name は必須です")
		return "", false
	}
	// テーブルの name は VARCHAR(100) なので、100文字まで
	if utf8.RuneCountInString(name) > 100 {
		writeError(w, http.StatusBadRequest, "name は100文字以内で指定してください")
		return "", false
	}

	// 同じ名前のカテゴリーがすでにあるか調べる
	var exists bool
	err := db.QueryRow(
		"SELECT EXISTS (SELECT 1 FROM categories WHERE name = $1 AND id <> $2)",
		name, exceptID,
	).Scan(&exists)
	if err != nil {
		log.Println("カテゴリー名の確認エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの保存に失敗しました")
		return "", false
	}
	if exists {
		writeError(w, http.StatusConflict, "同じ名前のカテゴリーがすでにあります")
		return "", false
	}

	return name, true
}

// getCategories は GET /api/categories : カテゴリー一覧を返す
//
// 【複数行を読むときの決まった書き方】
//
//	rows, err := db.Query("SELECT ...")   // SQL を実行して、結果（複数行）を受け取る
//	defer rows.Close()                    // 関数が終わるときに必ず後片付けする（defer = あとでやる）
//	for rows.Next() {                     // 1行ずつ進む
//	    rows.Scan(&c.ID, &c.Name)         // その行の列の値を、変数に入れる（SELECT の列の順番と同じにする）
//	}
//	rows.Err()                            // 途中でエラーがなかったか最後に確認する
func getCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name FROM categories ORDER BY id")
	if err != nil {
		log.Println("カテゴリー取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの取得に失敗しました")
		return
	}
	defer rows.Close()

	// 0件のときも null ではなく [] を返すため、空のスライスで始める
	categories := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name); err != nil {
			log.Println("読み取りエラー:", err)
			writeError(w, http.StatusInternalServerError, "カテゴリーの取得に失敗しました")
			return
		}
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		log.Println("カテゴリー取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの取得に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, categories)
}

// createCategory は POST /api/categories : カテゴリーを追加する
// リクエスト例: {"name": "食費"}
func createCategory(w http.ResponseWriter, r *http.Request) {
	name, ok := readCategoryName(w, r, 0)
	if !ok {
		return
	}

	// 追加した行を RETURNING でそのまま受け取る
	//
	// 【$1 とは（とても大事）】
	//   SQL の中の $1, $2 ... は「あとから値を入れる場所」。値は後ろの引数（ここでは name）で渡す。
	//   "... VALUES ('" + name + "')" のように文字をつなげて SQL を作ると、
	//   name に悪意のある文字（' や ; など）を入れられたとき、勝手な SQL を実行されてしまう（SQLインジェクション）。
	//   $1 を使えば、値はただの「データ」として扱われるので安全。
	//
	// 【RETURNING とは】
	//   INSERT した行の列（自動で振られた id など）を、そのまま結果として返してもらう PostgreSQL の機能。
	//   1行だけ返ってくるので、QueryRow(...).Scan(...) で受け取る。
	var c Category
	err := db.QueryRow(
		"INSERT INTO categories (name) VALUES ($1) RETURNING id, name", name,
	).Scan(&c.ID, &c.Name)
	if err != nil {
		log.Println("カテゴリー追加エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの追加に失敗しました")
		return
	}

	writeJSON(w, http.StatusCreated, c)
}

// updateCategory は PUT /api/categories/{id} : カテゴリー名を変更する
// リクエスト例: {"name": "外食"}
func updateCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	name, ok := readCategoryName(w, r, id)
	if !ok {
		return
	}

	var c Category
	err := db.QueryRow(
		"UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name", name, id,
	).Scan(&c.ID, &c.Name)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "カテゴリーが見つかりません")
		return
	}
	if err != nil {
		log.Println("カテゴリー更新エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの更新に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, c)
}

// deleteCategory は DELETE /api/categories/{id} : カテゴリーを削除する
func deleteCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}

	result, err := db.Exec("DELETE FROM categories WHERE id = $1", id)
	if err != nil {
		// 23503 = 外部キー違反（このカテゴリーを使っている支出がある）
		if hasPQCode(err, "23503") {
			writeError(w, http.StatusConflict, "このカテゴリーは支出で使われているため削除できません")
			return
		}
		log.Println("カテゴリー削除エラー:", err)
		writeError(w, http.StatusInternalServerError, "カテゴリーの削除に失敗しました")
		return
	}
	// 削除された行が0件なら、そのIDは存在しない
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "カテゴリーが見つかりません")
		return
	}

	// 削除成功：返す中身はないので 204 No Content
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// 4. 支出のAPI
// ============================================================

// Expense は expenses テーブルの1行を表す
type Expense struct {
	ID         int     `json:"id"`
	CategoryID int     `json:"category_id"`
	Amount     int     `json:"amount"`
	Date       string  `json:"date"`       // "2026-10-05" の形
	Memo       *string `json:"memo"`       // メモがないときは null
	CreatedAt  string  `json:"created_at"` // "2026-10-05T14:35:00" の形
}

// expenseColumns は Expense を読み出すときに使う列
// 日付と日時は、画面で扱いやすい形の文字にして取り出す
const expenseColumns = `id, category_id, amount, to_char(date, 'YYYY-MM-DD'), memo,
	COALESCE(to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS'), '')`

// scanExpense は1行分のデータを Expense に読み込む
func scanExpense(row interface{ Scan(...any) error }) (Expense, error) {
	var e Expense
	err := row.Scan(&e.ID, &e.CategoryID, &e.Amount, &e.Date, &e.Memo, &e.CreatedAt)
	return e, err
}

// expenseFilter は URL の ?from=&to=&category_id= から、SQL の WHERE 句と値を組み立てる
// 一覧（getExpenses）と集計（getSummary）で共通に使う
// ログイン中の会員の支出だけになるよう、user_id の条件は必ず付ける
func expenseFilter(q url.Values, userID int) (string, []any, error) {
	conds := []string{}
	args := []any{}
	// 条件を1つ追加する（$1, $2 ... の番号は自動で振る）
	add := func(cond string, value any) {
		args = append(args, value)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}

	add("user_id = $%d", userID)

	if from := q.Get("from"); from != "" {
		if !isValidDate(from) {
			return "", nil, errors.New("from は 2026-10-01 の形で指定してください")
		}
		add("date >= $%d", from)
	}
	if to := q.Get("to"); to != "" {
		if !isValidDate(to) {
			return "", nil, errors.New("to は 2026-10-31 の形で指定してください")
		}
		add("date <= $%d", to)
	}
	// category_id=1,2 のように、カンマ区切りで複数指定できる
	if s := q.Get("category_id"); s != "" {
		ids := []int64{}
		for _, part := range strings.Split(s, ",") {
			id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
			if err != nil || id <= 0 {
				return "", nil, errors.New("category_id は 1,2 のように数字で指定してください")
			}
			ids = append(ids, id)
		}
		add("category_id = ANY($%d)", pq.Array(ids))
	}

	return " WHERE " + strings.Join(conds, " AND "), args, nil
}

// expenseInput は追加・更新のときに受け取るデータ
type expenseInput struct {
	CategoryID int     `json:"category_id"`
	Amount     int     `json:"amount"`
	Date       string  `json:"date"`
	Memo       *string `json:"memo"`
}

// readExpenseInput はリクエストから支出のデータを読み込んでチェックする
func readExpenseInput(w http.ResponseWriter, r *http.Request) (expenseInput, bool) {
	var input expenseInput
	if !readJSON(w, r, &input) {
		return input, false
	}

	if input.CategoryID <= 0 {
		writeError(w, http.StatusBadRequest, "category_id は必須です")
		return input, false
	}
	if input.Amount < 1 || input.Amount > 999999999 {
		writeError(w, http.StatusBadRequest, "amount は1〜999999999の整数で指定してください")
		return input, false
	}
	if !isValidDate(input.Date) {
		writeError(w, http.StatusBadRequest, "date は 2026-10-05 の形で指定してください")
		return input, false
	}
	// メモは前後の空白を取り、空なら null（メモなし）として保存する
	if input.Memo != nil {
		memo := strings.TrimSpace(*input.Memo)
		if memo == "" {
			input.Memo = nil
		} else {
			input.Memo = &memo
		}
	}

	return input, true
}

// getExpenses は GET /api/expenses : ログイン中の会員の支出一覧を返す（新しい順）
// 絞り込み例: /api/expenses?from=2026-10-01&to=2026-10-31&category_id=1,2
func getExpenses(w http.ResponseWriter, r *http.Request) {
	where, args, err := expenseFilter(r.URL.Query(), currentUserID(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rows, err := db.Query(
		"SELECT "+expenseColumns+" FROM expenses"+where+" ORDER BY date DESC, created_at DESC, id DESC",
		args...,
	)
	if err != nil {
		log.Println("支出一覧の取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の取得に失敗しました")
		return
	}
	defer rows.Close()

	// 0件のときも null ではなく [] を返すため、空のスライスで始める
	expenses := []Expense{}
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			log.Println("読み取りエラー:", err)
			writeError(w, http.StatusInternalServerError, "支出の取得に失敗しました")
			return
		}
		expenses = append(expenses, e)
	}
	if err := rows.Err(); err != nil {
		log.Println("支出一覧の取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の取得に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, expenses)
}

// getExpense は GET /api/expenses/{id} : 支出を1件返す
// 他の会員の支出は「見つからない」として扱う
func getExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}

	// 「この ID で、しかも自分の支出」を探す。user_id の条件があるので、他人の支出は見つからない
	e, err := scanExpense(db.QueryRow(
		"SELECT "+expenseColumns+" FROM expenses WHERE id = $1 AND user_id = $2",
		id, currentUserID(r),
	))
	// sql.ErrNoRows は「1行も見つからなかった」という意味のエラー → 404 を返す
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "支出が見つかりません")
		return
	}
	if err != nil {
		log.Println("支出の取得エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の取得に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, e)
}

// createExpense は POST /api/expenses : 支出を追加する
// リクエスト例: {"category_id": 1, "amount": 1200, "date": "2026-10-05", "memo": "スーパー"}
func createExpense(w http.ResponseWriter, r *http.Request) {
	input, ok := readExpenseInput(w, r)
	if !ok {
		return
	}

	// 追加した行を RETURNING でそのまま受け取る
	// created_at は書かないので、初期値の CURRENT_TIMESTAMP（今の日時）が入る
	// user_id にはログイン中の会員IDを入れる
	e, err := scanExpense(db.QueryRow(
		"INSERT INTO expenses (category_id, amount, date, memo, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING "+expenseColumns,
		input.CategoryID, input.Amount, input.Date, input.Memo, currentUserID(r),
	))
	if err != nil {
		// 23503 = 外部キー違反（存在しないカテゴリーIDが指定された）
		if hasPQCode(err, "23503") {
			writeError(w, http.StatusBadRequest, "指定されたカテゴリーは存在しません")
			return
		}
		log.Println("支出の追加エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の追加に失敗しました")
		return
	}

	writeJSON(w, http.StatusCreated, e)
}

// updateExpense は PUT /api/expenses/{id} : 支出を更新する
// リクエスト例: {"category_id": 1, "amount": 1500, "date": "2026-10-05", "memo": "スーパー"}
func updateExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	input, ok := readExpenseInput(w, r)
	if !ok {
		return
	}

	e, err := scanExpense(db.QueryRow(
		"UPDATE expenses SET category_id = $1, amount = $2, date = $3, memo = $4 WHERE id = $5 AND user_id = $6 RETURNING "+expenseColumns,
		input.CategoryID, input.Amount, input.Date, input.Memo, id, currentUserID(r),
	))
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "支出が見つかりません")
		return
	}
	if err != nil {
		if hasPQCode(err, "23503") {
			writeError(w, http.StatusBadRequest, "指定されたカテゴリーは存在しません")
			return
		}
		log.Println("支出の更新エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の更新に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, e)
}

// deleteExpense は DELETE /api/expenses/{id} : 支出を削除する
func deleteExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}

	result, err := db.Exec("DELETE FROM expenses WHERE id = $1 AND user_id = $2", id, currentUserID(r))
	if err != nil {
		log.Println("支出の削除エラー:", err)
		writeError(w, http.StatusInternalServerError, "支出の削除に失敗しました")
		return
	}
	// 削除された行が0件なら、そのIDは存在しない
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "支出が見つかりません")
		return
	}

	// 削除成功：返す中身はないので 204 No Content
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// 5. 集計のAPI
// ============================================================

// CategoryTotal はカテゴリーごとの支出の合計
type CategoryTotal struct {
	CategoryID int    `json:"category_id"`
	Name       string `json:"name"`
	Amount     int64  `json:"amount"`
}

// Summary は期間の支出のまとめ
type Summary struct {
	From       string          `json:"from,omitempty"`
	To         string          `json:"to,omitempty"`
	Total      int64           `json:"total"`
	Count      int             `json:"count"`
	ByCategory []CategoryTotal `json:"by_category"` // 金額の多い順
}

// MonthlyTotal は1か月分の支出の合計
type MonthlyTotal struct {
	Month string `json:"month"` // "2026-10" の形
	Total int64  `json:"total"`
}

// getSummary は GET /api/summary : 期間の合計・件数とカテゴリー別の合計を返す
// 例: /api/summary?from=2026-10-01&to=2026-10-31
// （一覧と同じく category_id でも絞り込める）
func getSummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args, err := expenseFilter(q, currentUserID(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s := Summary{From: q.Get("from"), To: q.Get("to"), ByCategory: []CategoryTotal{}}

	// 期間全体の合計と件数（0件のとき SUM は NULL になるので 0 にする）
	err = db.QueryRow("SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM expenses"+where, args...).
		Scan(&s.Total, &s.Count)
	if err != nil {
		log.Println("集計エラー:", err)
		writeError(w, http.StatusInternalServerError, "集計に失敗しました")
		return
	}

	// カテゴリーごとの合計（カテゴリー名も一緒に取り出す）
	rows, err := db.Query(
		"SELECT e.category_id, c.name, SUM(e.amount) FROM expenses e"+
			" JOIN categories c ON c.id = e.category_id"+where+
			" GROUP BY e.category_id, c.name ORDER BY SUM(e.amount) DESC, e.category_id",
		args...,
	)
	if err != nil {
		log.Println("カテゴリー別集計エラー:", err)
		writeError(w, http.StatusInternalServerError, "集計に失敗しました")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ct CategoryTotal
		if err := rows.Scan(&ct.CategoryID, &ct.Name, &ct.Amount); err != nil {
			log.Println("読み取りエラー:", err)
			writeError(w, http.StatusInternalServerError, "集計に失敗しました")
			return
		}
		s.ByCategory = append(s.ByCategory, ct)
	}
	if err := rows.Err(); err != nil {
		log.Println("カテゴリー別集計エラー:", err)
		writeError(w, http.StatusInternalServerError, "集計に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, s)
}

// getMonthlySummary は GET /api/summary/monthly : 月ごとの合計を返す（棒グラフ用）
// 例: /api/summary/monthly?from=2026-05&months=6 → 2026年5月〜10月の6か月分
// 支出がない月も 0 として返す
func getMonthlySummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	start, err := time.Parse("2006-01", q.Get("from"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "from は 2026-05 の形で指定してください")
		return
	}
	months := 6
	if s := q.Get("months"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 24 {
			writeError(w, http.StatusBadRequest, "months は1〜24で指定してください")
			return
		}
		months = n
	}

	// generate_series で「月の一覧」を作り、そこに支出をくっつけて（LEFT JOIN）月ごとに合計する
	rows, err := db.Query(`
		SELECT to_char(m, 'YYYY-MM'), COALESCE(SUM(e.amount), 0)
		FROM generate_series($1::timestamp, $1::timestamp + ($2::int - 1) * interval '1 month', interval '1 month') AS m
		LEFT JOIN expenses e ON date_trunc('month', e.date::timestamp) = m AND e.user_id = $3
		GROUP BY m
		ORDER BY m`,
		start.Format("2006-01-02"), months, currentUserID(r),
	)
	if err != nil {
		log.Println("月別集計エラー:", err)
		writeError(w, http.StatusInternalServerError, "集計に失敗しました")
		return
	}
	defer rows.Close()

	totals := []MonthlyTotal{}
	for rows.Next() {
		var mt MonthlyTotal
		if err := rows.Scan(&mt.Month, &mt.Total); err != nil {
			log.Println("読み取りエラー:", err)
			writeError(w, http.StatusInternalServerError, "集計に失敗しました")
			return
		}
		totals = append(totals, mt)
	}
	if err := rows.Err(); err != nil {
		log.Println("月別集計エラー:", err)
		writeError(w, http.StatusInternalServerError, "集計に失敗しました")
		return
	}

	writeJSON(w, http.StatusOK, totals)
}

// ============================================================
// 6. サーバーの準備と起動
// ============================================================

// allowCORS は、HTMLを直接開いたとき（別の場所の画面）からでもAPIを使えるようにする
// ブラウザは、別の場所からのリクエストを、サーバーが許可したときだけ通す
// （requireAuth と同じく、すべてのリクエストの手前に立つミドルウェア）
func allowCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		// 本番のリクエストの前に、ブラウザが「送っていい？」と確認してくる（OPTIONS）ので、OKと返す
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// main はプログラムのスタート地点（go run . で最初に実行される）
// 流れ: 設定を読み込む → データベースにつなぐ → URL と処理を結びつける → サーバーを起動して待ち続ける
func main() {
	// .env ファイルを読み込んで環境変数にセットする
	// （環境変数 = パソコンやサーバーごとに変えたい設定を、プログラムの外に置いておくしくみ）
	if err := godotenv.Load(); err != nil {
		log.Fatal(".env ファイルの読み込みに失敗しました: ", err)
	}

	// 接続情報は .env の DATABASE_URL から取得する（コードには直接書かない）
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL が設定されていません")
	}

	// JWT の署名鍵は .env の JWT_SECRET から取得する（短すぎる鍵は破られやすいので32文字以上）
	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET が設定されていないか、短すぎます（32文字以上にしてください）")
	}

	// ポート番号は .env の PORT から取得する（書いていなければ 8080）
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// データベースに接続する
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("データベースの設定に失敗しました: ", err)
	}
	defer db.Close()

	// 本当に接続できるか確認する
	if err := db.Ping(); err != nil {
		log.Fatal("データベースに接続できません: ", err)
	}
	fmt.Println("データベースに接続しました")

	// API：「メソッド + パス」ごとに処理する関数を登録する（ルーティング）
	//
	// 【書き方】 http.HandleFunc("メソッド パス", 呼ぶ関数)
	//   "GET /api/expenses"       … GET で /api/expenses に来たら getExpenses を呼ぶ
	//   "PUT /api/expenses/{id}"  … {id} の部分は何でもよく、関数の中で r.PathValue("id") で取り出せる
	//
	// 【メソッドの意味（REST の決まりごと）】
	//   GET = 取得する / POST = 新しく作る / PUT = 書き換える / DELETE = 消す
	//
	// 会員登録・ログイン（ログインしていなくても使える）
	http.HandleFunc("POST /api/register", register)
	http.HandleFunc("POST /api/login", login)

	// ここから下は requireAuth で包んで、ログインしている人だけが使えるようにする
	http.HandleFunc("GET /api/me", requireAuth(getMe))

	// カテゴリー
	http.HandleFunc("GET /api/categories", requireAuth(getCategories))
	http.HandleFunc("POST /api/categories", requireAuth(createCategory))
	http.HandleFunc("PUT /api/categories/{id}", requireAuth(updateCategory))
	http.HandleFunc("DELETE /api/categories/{id}", requireAuth(deleteCategory))

	// 支出（ログイン中の会員の支出だけを扱う）
	http.HandleFunc("GET /api/expenses", requireAuth(getExpenses))
	http.HandleFunc("GET /api/expenses/{id}", requireAuth(getExpense))
	http.HandleFunc("POST /api/expenses", requireAuth(createExpense))
	http.HandleFunc("PUT /api/expenses/{id}", requireAuth(updateExpense))
	http.HandleFunc("DELETE /api/expenses/{id}", requireAuth(deleteExpense))

	// 集計
	http.HandleFunc("GET /api/summary", requireAuth(getSummary))
	http.HandleFunc("GET /api/summary/monthly", requireAuth(getMonthlySummary))

	// 画面：frontend フォルダの中のファイル（HTML・CSS・JS）をそのまま返す
	// http://localhost:8080 を開くと、ログイン画面が表示される
	http.Handle("/", http.FileServer(http.Dir("frontend")))

	// サーバーを起動したことをターミナルに表示する
	fmt.Printf("サーバーを起動しました: http://localhost:%s\n", port)

	// サーバーを起動する（エラーが起きたら終了する）
	log.Fatal(http.ListenAndServe(":"+port, allowCORS(http.DefaultServeMux)))
}
