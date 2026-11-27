# Models shipped with Forge

## forge-panels-1024.onnx
- Source: https://huggingface.co/Gunnm92/comic-panel-bubble-detection-yolo13n (`onnx/yolo13n_panel-bubble_det_1024_op18.onnx`)
- Licence: Apache-2.0
- Content: YOLOv13n detector, 2 classes (0 = panel, 1 = speech bubble), 1024×1024 letterboxed RGB input /255, output `[1, 6, N]` (cx, cy, w, h, two class scores).
- Unchanged copy, renamed.

## ocr-det-v3.onnx
- Source: https://huggingface.co/monkt/paddleocr-onnx (`detection/v3/det.onnx`), conversion of PaddleOCR PP-OCRv3 mobile text detection (https://github.com/PaddlePaddle/PaddleOCR)
- Licence: Apache-2.0
- Content: DB text-line detector, RGB input normalised with ImageNet mean/std, sides multiple of 32, output a text probability map of the same size.
- Unchanged copy, renamed.

## ocr-rec-en-v5.onnx + ocr-rec-en-v5.txt
- Source: https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx (`inference.onnx`, dictionary taken from `inference.yml`)
- Licence: Apache-2.0
- Content: PP-OCRv5 English text-line recogniser, input `[1, 3, 48, W]` normalised to −1..1, CTC output over the dictionary (index 0 = blank, last = space).
- Unchanged copy, renamed; the dictionary is the `character_dict` list, one character per line.
