from sklearn.svm import SVC
X = [[0, 0], [1, 1], [3, 3], [4, 4]]
y = [0, 0, 1, 1]
clf = SVC(kernel="linear", C=1000).fit(X, y)
print(clf.n_support_)