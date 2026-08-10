import sys
import analyzer

def main():
    """
    存在するCSVファイルを日付順（古い順）に並べ、
    隣り合うファイルペア（1番古い vs 2番目、2番目 vs 3番目...）で順次比較を実行します。
    """
    files = analyzer.get_sorted_csv_files()
    if len(files) < 2:
        print("エラー: 比較を行うには input_data ディレクトリ内にCSVファイルが2つ以上必要です。", file=sys.stderr)
        sys.exit(1)
        
    # 隣り合うペアで順次比較
    for i in range(len(files) - 1):
        file_older, _, label_older = files[i]
        file_newer, _, label_newer = files[i+1]
        
        analyzer.analyze_and_compare(
            file_newer=file_newer,
            file_older=file_older,
            label_newer=label_newer,
            label_older=label_older
        )

if __name__ == '__main__':
    main()
