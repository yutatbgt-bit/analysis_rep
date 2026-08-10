import sys
import analyzer

def main():
    """
    一番古いファイル（最も古いタイムスタンプ）を基準とし、
    それ以外のすべての新しいファイルと個別に比較を実行します。
    """
    files = analyzer.get_sorted_csv_files()
    if len(files) < 2:
        print("エラー: 比較を行うするには input_data ディレクトリ内にCSVファイルが2つ以上必要です。", file=sys.stderr)
        sys.exit(1)
        
    # files[0] が最も古いファイル（基準）
    file_older, _, label_older = files[0]
    
    # 2番目に古いファイル以降（より新しいファイル）を順に比較
    for file_newer, _, label_newer in files[1:]:
        analyzer.analyze_and_compare(
            file_newer=file_newer,
            file_older=file_older,
            label_newer=label_newer,
            label_older=label_older
        )

if __name__ == '__main__':
    main()
